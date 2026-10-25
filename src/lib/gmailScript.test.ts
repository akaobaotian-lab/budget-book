import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { gmailTxId, isScriptUrl, scriptCode, usageToTransaction, usagesFromMessages, type ScriptMessage } from './gmailScript';
import { pickAutoImport } from './useGmailAutoImport';
import { DEFAULT_GMAIL_QUERY } from './gmail';

const RAKUTEN = `楽天カードご利用のお知らせ
■利用日: 2026/10/24
■利用先: ローソン
■利用金額: 648 円

■利用日: 2026/10/25
■利用先: ユニクロ
■利用金額: 3,990 円`;

/** Apps Script の実行環境を真似て、生成したスクリプトを動かす */
function runScript(token: string, params: Record<string, string>) {
  const searched: { q: string; start: number; max: number }[] = [];
  const msg = (id: string) => ({
    getId: () => id,
    getDate: () => new Date('2026-10-25T10:00:00+09:00'),
    getFrom: () => 'info@mail.rakuten-card.co.jp',
    getSubject: () => 'カード利用のお知らせ',
    getPlainBody: () => RAKUTEN,
  });
  const sandbox = {
    GmailApp: {
      search: (q: string, start: number, max: number) => {
        searched.push({ q, start, max });
        // 同じメールが2つのスレッドに含まれても1回だけ返す
        return [{ getMessages: () => [msg('m1'), msg('m2')] }, { getMessages: () => [msg('m2')] }];
      },
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@gmail.com' }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ text, setMimeType() { return this; } }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptCode(token), sandbox);
  const out = vm.runInContext(`doGet(${JSON.stringify({ parameter: params })})`, sandbox) as { text: string };
  return { body: JSON.parse(out.text), searched };
}

describe('Apps Script', () => {
  const token = 'a'.repeat(48);

  it('rejects requests without the right token', () => {
    expect(runScript(token, { token: 'wrong' }).body).toEqual({ error: 'unauthorized' });
    expect(runScript(token, {}).body).toEqual({ error: 'unauthorized' });
  });

  it('returns card mails without duplicates', () => {
    const { body, searched } = runScript(token, { token });
    expect(searched[0].q).toBe(DEFAULT_GMAIL_QUERY);
    expect(body.email).toBe('me@gmail.com');
    expect(body.messages.map((m: ScriptMessage) => m.id)).toEqual(['m1', 'm2']);
    expect(body.messages[0]).toMatchObject({ subject: 'カード利用のお知らせ', from: 'info@mail.rakuten-card.co.jp' });
  });

  it('uses the custom query and caps the count', () => {
    const { searched } = runScript(token, { token, q: 'from:jcb', max: '9999' });
    expect(searched[0]).toEqual({ q: 'from:jcb', start: 0, max: 300 });
  });

  it('round-trips through the app parser', () => {
    const { body } = runScript(token, { token });
    const usages = usagesFromMessages(body.messages);
    // 2通 × 2件
    expect(usages).toHaveLength(4);
    expect(usages[0]).toMatchObject({ date: '2026-10-25', merchant: 'ユニクロ', amount: 3990, card: '楽天カード' });
    expect(new Set(usages.map((u) => u.key)).size).toBe(4);
  });
});

describe('gmail import helpers', () => {
  it('validates the web app URL', () => {
    expect(isScriptUrl('https://script.google.com/macros/s/AKfycbx_abc-123/exec')).toBe(true);
    expect(isScriptUrl(' https://script.google.com/macros/s/AKfycbx_abc-123/exec ')).toBe(true);
    expect(isScriptUrl('https://script.google.com/macros/library/d/abc/1')).toBe(false);
    expect(isScriptUrl('https://script.google.com/macros/s/abc/dev')).toBe(false);
  });

  it('auto-imports only new usages since connecting', () => {
    const usages = usagesFromMessages([{ id: 'm1', date: Date.parse('2026-10-25'), from: 'rakuten', subject: '利用', body: RAKUTEN }]);
    expect(pickAutoImport(usages, new Set(), '2026-10-25').map((u) => u.merchant)).toEqual(['ユニクロ']);
    expect(pickAutoImport(usages, new Set(['m1#1']), undefined).map((u) => u.merchant)).toEqual(['ローソン']);
  });

  it('gives the same transaction id on every device', () => {
    const [u] = usagesFromMessages([{ id: '18f2a#x', date: 0, from: 'jcb', subject: '利用', body: '【ご利用金額】 500円' }]);
    const t = usageToTransaction(u, 'auto');
    expect(t.id).toBe(gmailTxId(u.key));
    expect(t.id).toMatch(/^gmail-[\w-]+$/);
    expect(t).toMatchObject({ kind: 'expense', amount: 500, source: 'gmail', gmailId: u.key });
  });
});

import { gmailFromShareText, gmailShareUrl } from './gmailScript';

describe('gmail share link', () => {
  it('round-trips the script URL and token, even inside other text', () => {
    const link = gmailShareUrl('https://akaobaotian-lab.github.io/budget-book/', 'https://script.google.com/macros/s/AKfy_1-2/exec', 'ab'.repeat(24));
    expect(link).toContain('#gmail=');
    expect(gmailFromShareText(`家計簿の設定 ${link}`)).toEqual({ scriptUrl: 'https://script.google.com/macros/s/AKfy_1-2/exec', scriptToken: 'ab'.repeat(24) });
  });
  it('rejects broken or foreign links', () => {
    expect(gmailFromShareText('https://example.com/#gmail=xxx')).toBeNull();
    expect(gmailFromShareText('https://example.com/')).toBeNull();
    const evil = btoa(JSON.stringify({ u: 'https://evil.example/exec', t: 'ab'.repeat(24) }));
    expect(gmailFromShareText(`#gmail=${evil}`)).toBeNull();
  });
});

import { attachItems, itemsToAdd, ordersFromMessages } from './gmailScript';
import type { Transaction } from '../types';

describe('items from order mails', () => {
  const card: ScriptMessage = {
    id: 'c1', date: Date.parse('2026-10-21T10:00:00+09:00'), from: 'info@mail.rakuten-card.co.jp', subject: 'カード利用のお知らせ',
    body: '■利用日: 2026/10/21\n■利用先: AMAZON.CO.JP\n■利用金額: 1,980 円',
  };
  const order: ScriptMessage = {
    id: 'o1', date: Date.parse('2026-10-20T09:00:00+09:00'), from: '"Amazon.co.jp" <auto-confirm@amazon.co.jp>', subject: '注文済み',
    body: 'ご注文ありがとうございます\nボックスティッシュ 5箱パック\n数量: 1\n1,980 円\n合計 1,980 円',
  };

  it('attaches items and picks the category from them', () => {
    const [u] = attachItems(usagesFromMessages([card]), ordersFromMessages([order]));
    expect(u.items).toEqual(['ボックスティッシュ 5箱パック']);
    const t = usageToTransaction(u, 'auto');
    expect(t).toMatchObject({ memo: 'AMAZON.CO.JP', items: ['ボックスティッシュ 5箱パック'], category: '日用品', group: 'living' });
  });

  it('fills items into previously imported transactions only', () => {
    const [u] = attachItems(usagesFromMessages([card]), ordersFromMessages([order]));
    const base = { date: '2026-10-21', kind: 'expense' as const, amount: 1980, memo: 'AMAZON', source: 'gmail' as const, createdAt: 0 };
    const txs: Transaction[] = [
      { ...base, id: 'a', gmailId: u.key },
      { ...base, id: 'b', gmailId: u.key, items: ['手で入れた商品'] },
      { ...base, id: 'c', gmailId: 'other#0' },
    ];
    expect(itemsToAdd(txs, [u])).toEqual([{ id: 'a', patch: { items: ['ボックスティッシュ 5箱パック'] } }]);
  });
});

describe('ご利用内容', () => {
  it('is imported and back-filled into older transactions', () => {
    const msg: ScriptMessage = { id: 'd1', date: Date.parse('2026-10-25'), from: 'statement@vpass.ne.jp', subject: 'ご利用のお知らせ', body: 'ご利用日時：2026/10/25 10:00\nご利用場所：ローソン\nご利用取引：買物\nご利用金額：300円' };
    const [u] = usagesFromMessages([msg]);
    expect(usageToTransaction(u, 'auto')).toMatchObject({ memo: 'ローソン', detail: '買物' });
    const old: Transaction = { id: 'x', date: '2026-10-25', kind: 'expense', amount: 300, memo: 'ローソン', source: 'gmail', createdAt: 0, gmailId: u.key };
    expect(itemsToAdd([old], [u])).toEqual([{ id: 'x', patch: { detail: '買物' } }]);
    expect(itemsToAdd([{ ...old, detail: '手で変更' }], [u])).toEqual([]);
  });
});
