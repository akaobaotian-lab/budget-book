import { parseCardMail } from './cardMailParser';
import { defaultGroupFor, guessCategory } from './categories';
import { toISODate } from './date';
import { DEFAULT_GMAIL_QUERY, type MailUsage } from './gmail';
import type { ExpenseGroup, Transaction } from '../types';
import { ORDER_QUERY, isOrderMail, matchOrders, parseOrderMail, type OrderMail } from './orderMailParser';
import type { NewTransaction } from '../store';

/**
 * Google Apps Script を使った Gmail 取り込み。
 * 自分の Google アカウントでスクリプトを動かすため、Google Cloud の設定（クライアントID・テストユーザー）が不要で、
 * ログインの有効期限もないので、アプリを開いたときに自動で取り込める。
 */

/** スクリプトから返るメール */
export interface ScriptMessage {
  id: string;
  /** 受信日時（ミリ秒） */
  date: number;
  from: string;
  subject: string;
  body: string;
}

/** ランダムな合言葉（スクリプトのURLを知っているだけでは読めないようにする） */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** ユーザーが script.google.com に貼り付けるスクリプト */
export function scriptCode(token: string): string {
  return `// 家計簿アプリ用：カード利用通知メールを読み取って家計簿に渡します。
// このスクリプトはあなたの Google アカウントの中だけで動き、メールの送信・削除はしません。
const TOKEN = '${token}';
const DEFAULT_QUERY = ${JSON.stringify(DEFAULT_GMAIL_QUERY)};

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return json_({ error: 'unauthorized' });
  const query = p.q || DEFAULT_QUERY;
  const max = Math.min(Number(p.max) || 100, 300);
  const messages = [];
  const seen = {};
  const threads = GmailApp.search(query, 0, max);
  for (const thread of threads) {
    for (const m of thread.getMessages()) {
      const id = m.getId();
      if (seen[id]) continue;
      seen[id] = true;
      messages.push({
        id: id,
        date: m.getDate().getTime(),
        from: m.getFrom(),
        subject: m.getSubject(),
        body: m.getPlainBody().slice(0, 20000),
      });
    }
  }
  return json_({ email: Session.getEffectiveUser().getEmail(), messages: messages.slice(0, max) });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

/** 貼り付けられたURLが Apps Script のウェブアプリか */
export function isScriptUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim());
}

/** メールからカード利用を取り出す（1通に複数件あれば複数） */
export function usagesFromMessages(messages: ScriptMessage[]): MailUsage[] {
  const out: MailUsage[] = [];
  for (const m of messages) {
    // 注文確認メールはカードの支払いと二重にならないよう明細にしない
    if (isOrderMail(m.body, m.from, m.subject)) continue;
    const received = toISODate(new Date(m.date));
    parseCardMail(m.body, m.from, m.subject, received).forEach((u, idx) =>
      out.push({ ...u, messageId: m.id, key: `${m.id}#${idx}`, subject: m.subject }),
    );
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** 注文確認メールから注文内容を取り出す */
export function ordersFromMessages(messages: ScriptMessage[]): OrderMail[] {
  return messages
    .map((m) => parseOrderMail(m.id, m.body, m.from, m.subject, toISODate(new Date(m.date))))
    .filter((o): o is OrderMail => !!o);
}

/** カード利用に、金額と日付が合う注文メールの商品名を付ける */
export function attachItems(usages: MailUsage[], orders: OrderMail[]): MailUsage[] {
  const matched = matchOrders(usages, orders);
  return usages.map((u) => (matched.has(u.key) ? { ...u, items: matched.get(u.key)!.items } : u));
}

/**
 * カードの利用通知を読み取り、注文確認メールがあれば買った商品名も付ける。
 * 注文メールの読み取りに失敗しても、カードの利用は返す。
 */
export async function fetchViaScript(
  url: string,
  token: string,
  query: string,
): Promise<{ email: string; usages: MailUsage[]; orderMessageIds: string[] }> {
  const { email, messages } = await fetchScriptMessages(url, token, query || DEFAULT_GMAIL_QUERY);
  const usages = usagesFromMessages(messages);
  // カード通知の検索に注文メールが混ざっていた場合も、商品名の情報として使う
  let orders: OrderMail[] = ordersFromMessages(messages);
  try {
    const more = ordersFromMessages((await fetchScriptMessages(url, token, ORDER_QUERY)).messages);
    const seen = new Set(orders.map((o) => o.messageId));
    orders = [...orders, ...more.filter((o) => !seen.has(o.messageId))];
  } catch {
    // 商品名は補助的な情報なので、取れなくても続ける
  }
  const orderMessageIds = messages.filter((m) => isOrderMail(m.body, m.from, m.subject)).map((m) => m.id);
  return { email, usages: attachItems(usages, orders), orderMessageIds };
}

/** 以前の版で注文メールから作られてしまった明細（カードの支払いと二重になっているもの） */
export function duplicatesFromOrderMails(transactions: Transaction[], orderMessageIds: string[]): Transaction[] {
  const ids = new Set(orderMessageIds);
  return transactions.filter((t) => t.gmailId && ids.has(t.gmailId.split('#')[0]));
}

async function fetchScriptMessages(url: string, token: string, query: string): Promise<{ email: string; messages: ScriptMessage[] }> {
  if (!isScriptUrl(url)) throw new Error('URL が正しくありません。「https://script.google.com/macros/s/…/exec」の形のURLを貼り付けてください');
  const q = new URLSearchParams({ token, q: query });
  let res: Response;
  try {
    res = await fetch(`${url.trim()}?${q}`);
  } catch {
    throw new Error('スクリプトに接続できません。デプロイの「アクセスできるユーザー」が「全員」になっているか確認してください');
  }
  if (!res.ok) throw new Error(`スクリプトのエラー (${res.status})`);
  const text = await res.text();
  let body: { error?: string; email?: string; messages?: ScriptMessage[] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('スクリプトの応答を読み取れません。アクセスできるユーザーを「全員」にしてデプロイし直してください');
  }
  if (body.error === 'unauthorized') throw new Error('合言葉が一致しません。アプリに表示されているスクリプトを貼り付け直して、新しいバージョンをデプロイしてください');
  if (body.error) throw new Error(body.error);
  return { email: body.email ?? '', messages: body.messages ?? [] };
}

/** 取り込み済みの判定と、明細への変換 */
export function gmailTxId(key: string): string {
  // 複数の端末が同じメールを取り込んでも重複しないよう、メールから決まるIDにする
  return `gmail-${key.replace(/[^\w-]/g, '_')}`;
}

export function usageToTransaction(u: MailUsage, group: ExpenseGroup | 'auto'): NewTransaction {
  // 商品名からカテゴリが分かればそれを使う（Amazon などは店名だけでは分からない）
  const fromItems = u.items?.length ? guessCategory(u.items.join(' ')) : 'その他';
  const category = fromItems !== 'その他' ? fromItems : guessCategory(u.merchant);
  return {
    id: gmailTxId(u.key),
    kind: 'expense',
    date: u.date,
    amount: u.amount,
    memo: u.merchant,
    category,
    group: group === 'auto' ? defaultGroupFor(category) : group,
    source: 'gmail',
    gmailId: u.key,
    items: u.items,
    detail: u.detail,
  };
}

/**
 * 取り込み済みの明細に、まだ入っていない「ご利用内容」と商品名を後から付ける
 * （手で直したカテゴリや店名などは変えない）
 */
export function itemsToAdd(transactions: Transaction[], usages: MailUsage[]): { id: string; patch: Pick<Transaction, 'items' | 'detail'> }[] {
  const byKey = new Map(usages.map((u) => [u.key, u]));
  const out: { id: string; patch: Pick<Transaction, 'items' | 'detail'> }[] = [];
  for (const t of transactions) {
    const u = t.gmailId ? byKey.get(t.gmailId) : undefined;
    if (!u) continue;
    const patch: Pick<Transaction, 'items' | 'detail'> = {};
    if (!t.items?.length && u.items?.length) patch.items = u.items;
    if (!t.detail && u.detail) patch.detail = u.detail;
    if (patch.items || patch.detail) out.push({ id: t.id, patch });
  }
  return out;
}

/** 他の端末に Gmail 取り込みの設定（URLと合言葉）を渡すリンク。#以降はサーバーに送信されない */
export function gmailShareUrl(base: string, url: string, token: string): string {
  return `${base}#gmail=${encodeURIComponent(btoa(JSON.stringify({ u: url, t: token })))}`;
}

/** 共有リンク（またはその一部を含む文章）から設定を取り出す */
export function gmailFromShareText(text: string): { scriptUrl: string; scriptToken: string } | null {
  const m = text.match(/gmail=([^\s&]+)/);
  if (!m) return null;
  try {
    const { u, t } = JSON.parse(atob(decodeURIComponent(m[1]))) as { u?: string; t?: string };
    return u && t && isScriptUrl(u) && /^[0-9a-f]{16,}$/.test(t) ? { scriptUrl: u, scriptToken: t } : null;
  } catch {
    return null;
  }
}
