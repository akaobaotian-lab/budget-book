import { normalizeWidth } from './japaneseNumber';

/**
 * ネットショップの注文確認メール（Amazon・楽天市場・Yahoo!ショッピングなど）から、
 * 買った商品名と合計金額を読み取る。カードの利用通知には商品名が書かれていないため、
 * 金額と日付が合う注文メールを探して商品名を補う。
 */

export interface OrderMail {
  messageId: string;
  /** 受信日 YYYY-MM-DD */
  date: string;
  /** 注文の合計金額 */
  total: number;
  items: string[];
  /** 送信元（店名） */
  shop: string;
}

/** 注文確認メールを探す Gmail の検索条件 */
export const ORDER_QUERY =
  'subject:(注文 OR ご注文 OR 購入 OR お買い上げ OR 領収 OR レシート OR receipt OR order) -subject:(発送 OR 配達 OR 配送 OR お届け) newer_than:60d';

const TOTAL_LABELS: RegExp[] = [
  /(?:ご?注文合計|注文金額合計|order total)/i,
  /(?:お支払い?(?:金額|合計)|支払い?金額|ご請求(?:金額|額)|請求金額|お買い?上げ金額)/,
  /(?:合計金額|総合計|総額|合計|total)/i,
];

const PRICE = /[¥￥]?\s*([\d,]+)\s*(?:円|\(円\)|JPY)?/;

/** 商品名として扱わない行 */
const NOT_ITEM =
  /^(?:[¥￥]?\s*[\d,]+\s*(?:円|\(円\))?|数量|個数|価格|単価|小計|合計|送料|手数料|ポイント|クーポン|割引|税|お届け|配送|注文|ご注文|お支払|支払|請求|お客様|販売|出品|ショップ|店舗|お問い?合わせ|https?:|www\.|[-=*_─━]+$)/;

function cleanItem(s: string): string {
  return s
    .replace(/^[\s・●■◆▼▶>＞\-–*]+/, '')
    .replace(/^["「『](.*)["」』]$/, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isItemLine(s: string): boolean {
  const t = cleanItem(s);
  return t.length >= 2 && !NOT_ITEM.test(t) && !/^[\d\s,.:/()¥￥円\-]+$/.test(t);
}

function findTotal(lines: string[]): number | null {
  for (const label of TOTAL_LABELS) {
    let found: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i]) || /送料|手数料|ポイント|税込?対象|割引/.test(lines[i])) continue;
      const after = lines[i].slice(lines[i].search(label));
      const m = after.match(new RegExp(`[:：]?\\s*${PRICE.source}`)) ;
      const v = m && /\d/.test(m[1]) ? Number(m[1].replace(/,/g, '')) : NaN;
      if (v > 0) found = v;
      else if (lines[i + 1]) {
        const n = lines[i + 1].match(new RegExp(`^${PRICE.source}$`));
        if (n) found = Number(n[1].replace(/,/g, ''));
      }
    }
    // 同じ種類の見出しが複数あれば最後のもの（最終的な合計）を使う
    if (found) return found;
  }
  return null;
}

function findItems(lines: string[]): string[] {
  const items: string[] = [];
  const add = (s: string) => {
    const t = cleanItem(s);
    if (isItemLine(t) && !items.includes(t)) items.push(t);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 「商品名：〇〇」の形
    const labelled = line.match(/^[\s・●■【\[]*(?:商品名?|品名|ご?注文商品|購入商品|アイテム)[】\]]?\s*[:：]\s*(.+)$/);
    if (labelled) {
      add(labelled[1]);
      continue;
    }
    // 次の行が「数量」「価格 … x 個数」なら、その行が商品名（Amazon・楽天市場など）
    const next = lines[i + 1] ?? '';
    if (/^(?:数量|個数)\s*[:：]?\s*\d+/.test(next) || /^価格\s*[:：]?\s*[\d,]+.*[x×]/.test(next) || /^[\d,]+\s*円\s*[x×]\s*\d+/.test(next)) {
      add(line);
      continue;
    }
    // 「〇〇 ×1 1,980円」の形
    const inline = line.match(/^(.+?)\s*[x×]\s*\d+\s*(?:個|点|コ)?\s*[¥￥]?\s*[\d,]+\s*円?$/);
    if (inline) add(inline[1]);
  }
  return items.slice(0, 20);
}

function shopName(from: string, subject: string): string {
  const display = from.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  const name = display || from.match(/@([\w.-]+)/)?.[1] || '';
  return name || subject.slice(0, 30);
}

export function parseOrderMail(messageId: string, body: string, from: string, subject: string, received: string): OrderMail | null {
  const lines = normalizeWidth(body)
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const total = findTotal(lines);
  const items = findItems(lines);
  if (!total || items.length === 0) return null;
  return { messageId, date: received, total, items, shop: shopName(from, subject) };
}

const DAY = 24 * 60 * 60 * 1000;
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** カードの利用先と注文メールの店が同じらしいか */
function sameShop(merchant: string, order: OrderMail): boolean {
  const m = merchant.toLowerCase();
  const s = order.shop.toLowerCase();
  const pairs: [RegExp, RegExp][] = [
    [/amazon|アマゾン/, /amazon/],
    [/楽天|rakuten/, /楽天|rakuten/],
    [/yahoo|ヤフー|paypay/, /yahoo|ヤフー|paypay/],
    [/mercari|メルカリ/, /mercari|メルカリ/],
    [/uber/, /uber/],
    [/apple|itunes/, /apple/],
    [/google/, /google/],
  ];
  return pairs.some(([a, b]) => a.test(m) && b.test(s)) || (s.length >= 3 && m.includes(s.slice(0, 6)));
}

/**
 * カード利用と注文メールを、金額が同じ・日付が近い（10日以内）もので結びつける。
 * 店が同じらしいもの、日付が近いものを優先し、1通の注文は1件の利用にだけ使う。
 */
export function matchOrders<T extends { key: string; date: string; amount: number; merchant: string }>(
  usages: T[],
  orders: OrderMail[],
): Map<string, OrderMail> {
  const result = new Map<string, OrderMail>();
  const used = new Set<string>();
  // 候補の少ない利用から順に決める
  const candidates = usages
    .map((u) => ({
      u,
      list: orders
        .filter((o) => o.total === u.amount && dayDiff(o.date, u.date) <= 10)
        .sort((a, b) => Number(sameShop(u.merchant, b)) - Number(sameShop(u.merchant, a)) || dayDiff(a.date, u.date) - dayDiff(b.date, u.date)),
    }))
    .filter((c) => c.list.length > 0)
    .sort((a, b) => a.list.length - b.list.length);
  for (const { u, list } of candidates) {
    const o = list.find((x) => !used.has(x.messageId));
    if (!o) continue;
    used.add(o.messageId);
    result.set(u.key, o);
  }
  return result;
}
