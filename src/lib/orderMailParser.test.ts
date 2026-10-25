import { describe, expect, it } from 'vitest';
import { matchOrders, parseOrderMail } from './orderMailParser';

const AMAZON = `Amazon.co.jp
ご注文ありがとうございます
お届け予定： 10月22日
注文番号 250-1234567-1234567

アイリスオーヤマ ボックスティッシュ 5箱パック
数量: 1
1,280 円

キッコーマン いつでも新鮮 しぼりたて生しょうゆ 450ml
数量: 2
700 円

小計 1,980 円
配送料・手数料 0 円
合計 1,980 円`;

const RAKUTEN = `【楽天市場】注文内容ご確認（自動配信メール）
[受注番号] 123456-20261020-0000000001
[日時] 2026-10-20 12:00:00
[注文者] 岡田 様
[ショップ名] ○○ストア
----------
[商品]
北海道産 新米 ゆめぴりか 5kg
価格  3,480(円) x  1(個) = 3,480(円)
----------
小計  3,480(円)
送料  0(円)
合計  3,480(円)
支払い金額  3,480(円)`;

const LABELLED = `Yahoo!ショッピング ご注文確認
商品名：ワイヤレスイヤホン Bluetooth5.3
単価：4,980円
数量：1
お支払い金額：4,980円`;

const SHIPPING_ONLY = `ご注文の商品を発送しました。
お問い合わせ番号 1234-5678`;

describe('parseOrderMail', () => {
  it('reads Amazon order confirmations', () => {
    expect(parseOrderMail('a1', AMAZON, '"Amazon.co.jp" <auto-confirm@amazon.co.jp>', '注文済み', '2026-10-20')).toEqual({
      messageId: 'a1',
      date: '2026-10-20',
      total: 1980,
      shop: 'Amazon.co.jp',
      items: ['アイリスオーヤマ ボックスティッシュ 5箱パック', 'キッコーマン いつでも新鮮 しぼりたて生しょうゆ 450ml'],
    });
  });
  it('reads Rakuten order confirmations (payment total)', () => {
    const o = parseOrderMail('r1', RAKUTEN, '楽天市場 <order@rakuten.co.jp>', '【楽天市場】注文内容ご確認', '2026-10-20');
    expect(o).toMatchObject({ total: 3480, items: ['北海道産 新米 ゆめぴりか 5kg'], shop: '楽天市場' });
  });
  it('reads labelled formats', () => {
    expect(parseOrderMail('y1', LABELLED, 'Yahoo!ショッピング <x@shopping.yahoo.co.jp>', 'ご注文確認', '2026-10-20')).toMatchObject({
      total: 4980,
      items: ['ワイヤレスイヤホン Bluetooth5.3'],
    });
  });
  it('ignores mails without items or totals', () => {
    expect(parseOrderMail('s1', SHIPPING_ONLY, 'x', '発送', '2026-10-20')).toBeNull();
  });
});

describe('matchOrders', () => {
  const order = (id: string, date: string, total: number, shop: string) => ({ messageId: id, date, total, items: [id], shop });
  it('matches by amount and nearby date, preferring the same shop', () => {
    const usages = [
      { key: 'u1', date: '2026-10-21', amount: 1980, merchant: 'AMAZON.CO.JP' },
      { key: 'u2', date: '2026-10-22', amount: 1980, merchant: '楽天市場' },
      { key: 'u3', date: '2026-10-22', amount: 500, merchant: 'ローソン' },
    ];
    const orders = [order('rakuten', '2026-10-20', 1980, '楽天市場'), order('amazon', '2026-10-20', 1980, 'Amazon.co.jp'), order('old', '2026-09-01', 500, 'x')];
    const m = matchOrders(usages, orders);
    expect(m.get('u1')?.messageId).toBe('amazon');
    expect(m.get('u2')?.messageId).toBe('rakuten');
    // 日付が離れすぎた注文は使わない
    expect(m.has('u3')).toBe(false);
  });
  it('uses each order only once', () => {
    const usages = [
      { key: 'u1', date: '2026-10-21', amount: 1000, merchant: 'AMAZON' },
      { key: 'u2', date: '2026-10-21', amount: 1000, merchant: 'AMAZON' },
    ];
    const m = matchOrders(usages, [order('o1', '2026-10-20', 1000, 'Amazon.co.jp')]);
    expect(m.size).toBe(1);
  });
});
