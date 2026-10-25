import { describe, expect, it } from 'vitest';
import { parseJapaneseNumber, extractYenAmounts } from './japaneseNumber';
import { parseVoiceText } from './voiceParser';
import { parseReceiptText } from './receiptParser';
import { parseCardMail } from './cardMailParser';
import { estimateTax, incomeTax } from './tax';
import { generateRecurring } from './recurring';
import { dailyBreakdown, lendingByPerson, summarizeMonth } from './summary';
import type { Recurring, TaxSettings, Transaction } from '../types';

const tx = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(), date: '2026-10-01', kind: 'expense', amount: 0, memo: '', source: 'manual', createdAt: 0, ...p,
});

describe('parseJapaneseNumber', () => {
  it.each([
    ['2500', 2500], ['3,500', 3500], ['１２００', 1200], ['1万2000', 12000], ['二千五百', 2500],
    ['1.5万', 15000], ['十二', 12], ['3万', 30000], ['2千5百', 2500], ['千', 1000],
  ])('%s → %d', (s, n) => expect(parseJapaneseNumber(s)).toBe(n));
  it('extracts yen amounts', () => {
    expect(extractYenAmounts('ランチ1200円とコーヒー¥450').map((a) => a.value)).toEqual([1200, 450]);
  });
});

describe('parseVoiceText', () => {
  const base = '2026-10-25';
  it('expense with category and date', () => {
    const r = parseVoiceText('昨日スーパーで食費2500円', base);
    expect(r).toMatchObject({ kind: 'expense', date: '2026-10-24', amount: 2500, category: '食費', group: 'living' });
  });
  it('personal shopping', () => {
    const r = parseVoiceText('自分の買い物 ユニクロ 3990円', base);
    expect(r).toMatchObject({ kind: 'expense', amount: 3990, group: 'personal', category: '衣服・美容' });
  });
  it('lending', () => {
    expect(parseVoiceText('田中さんに5000円貸した', base)).toMatchObject({ kind: 'lend', amount: 5000, person: '田中', memo: '' });
    expect(parseVoiceText('10月3日 居酒屋で佐藤くんに1万円貸した', base)).toMatchObject({ kind: 'lend', date: '2026-10-03', amount: 10000, person: '佐藤', memo: '居酒屋' });
  });
  it('repayment', () => {
    expect(parseVoiceText('田中さんから3000円返してもらった', base)).toMatchObject({ kind: 'repay', amount: 3000, person: '田中' });
  });
  it('keiba', () => {
    expect(parseVoiceText('競馬で3000円買って払い戻し1万2000円', base)).toMatchObject({ kind: 'keiba', amount: 3000, payout: 12000 });
  });
  it('side income', () => {
    expect(parseVoiceText('副業の報酬5万円入金', base)).toMatchObject({ kind: 'income', incomeType: 'side', amount: 50000 });
  });
});

describe('parseReceiptText', () => {
  it('finds store, date and total', () => {
    const text = `ファミリーマート 渋谷店
TEL 03-1234-5678
2026年10月20日(火) 12:34
おにぎり ¥150
お茶 ¥128
小計 ¥278
(内消費税等 ¥22)
合計 ¥300
お預り ¥1,000
お釣 ¥700`;
    expect(parseReceiptText(text)).toEqual({ store: 'ファミリーマート渋谷店', date: '2026-10-20', amount: 300, category: '食費' });
  });
  it('removes OCR spaces between Japanese characters', () => {
    expect(parseReceiptText('ロー ソン 新宿 店\n合計 ¥278').store).toBe('ローソン新宿店');
  });
  it('handles era dates and next-line totals', () => {
    const r = parseReceiptText('スーパーライフ\nR8.10.5\n合 計\n1,234円');
    expect(r.date).toBe('2026-10-05');
    expect(r.amount).toBe(1234);
  });
});

describe('parseCardMail', () => {
  it('Rakuten style with multiple usages', () => {
    const body = `楽天カードをご利用いただきありがとうございます。
■利用日: 2026/10/20
■利用先: AMAZON.CO.JP
■利用者: 本人
■支払方法: 1回
■利用金額: 1,980 円
■支払月: 2026/11

■利用日: 2026/10/21
■利用先: セブン－イレブン
■利用者: 本人
■支払方法: 1回
■利用金額: 540 円`;
    const r = parseCardMail(body, 'info@mail.rakuten-card.co.jp', 'カード利用のお知らせ', '2026-10-22');
    expect(r).toEqual([
      { date: '2026-10-20', amount: 1980, merchant: 'AMAZON.CO.JP', card: '楽天カード' },
      { date: '2026-10-21', amount: 540, merchant: 'セブン－イレブン', card: '楽天カード' },
    ]);
  });
  it('SMBC style', () => {
    const body = `ご利用カード：三井住友カード
ご利用日時：2026/10/18 19:22
ご利用場所：スターバックス
ご利用取引：買物
ご利用金額：650円`;
    expect(parseCardMail(body, 'statement@vpass.ne.jp', 'ご利用のお知らせ', '2026-10-18')).toEqual([
      { date: '2026-10-18', amount: 650, merchant: 'スターバックス', card: '三井住友カード' },
    ]);
  });
  it('JCB style with value on next line', () => {
    const body = `【ご利用日時(日本時間)】
2026/10/17 10:00
【ご利用金額】 3,300円
【ご利用先】 ENEOS`;
    expect(parseCardMail(body, 'mail@qa.jcb.co.jp', 'JCBカード／ショッピングご利用のお知らせ', '2026-10-17')).toEqual([
      { date: '2026-10-17', amount: 3300, merchant: 'ENEOS', card: 'JCB' },
    ]);
  });
});

describe('tax', () => {
  const s: TaxSettings = { salaried: true, salaryAnnual: 4_000_000, socialInsuranceRate: 0.15, otherDeductions: 0 };
  it('income tax brackets', () => {
    expect(incomeTax(1_000_000)).toBe(Math.floor(50_000 * 1.021));
    expect(incomeTax(3_000_000)).toBe(Math.floor((300_000 - 97_500) * 1.021));
  });
  it('side income under 200k: no income tax, resident tax only', () => {
    const r = estimateTax([tx({ kind: 'income', incomeType: 'side', amount: 150_000, date: '2026-05-01' })], 2026, s);
    expect(r.filingExempt).toBe(true);
    expect(r.incomeTax).toBe(0);
    expect(r.residentTax).toBe(15_000);
    expect(r.remainingToThreshold).toBe(50_001);
  });
  it('side income over 200k triggers income tax', () => {
    const r = estimateTax([
      tx({ kind: 'income', incomeType: 'side', amount: 400_000, date: '2026-05-01' }),
      tx({ kind: 'expense', sideExpense: true, amount: 100_000, date: '2026-05-02' }),
    ], 2026, s);
    expect(r.sideIncome).toBe(300_000);
    expect(r.filingExempt).toBe(false);
    expect(r.incomeTax).toBeGreaterThan(0);
    expect(r.residentTax).toBe(30_000);
  });
  it('keiba temporary income', () => {
    const r = estimateTax([tx({ kind: 'keiba', amount: 10_000, payout: 1_500_000, hitCost: 100_000, date: '2026-06-01' })], 2026, s);
    expect(r.temporaryIncome).toBe(900_000);
    expect(r.temporaryTaxable).toBe(450_000);
    expect(r.incomeTax).toBeGreaterThan(0);
  });
});

describe('generateRecurring', () => {
  const r: Recurring = { id: 'r1', name: '家賃', amount: 80000, day: 31, kind: 'expense', group: 'living', category: '住居', active: true, startMonth: '2026-08' };
  it('fills each month up to today, clamped to month end', () => {
    const { transactions, recurring } = generateRecurring([r], '2026-10-25');
    expect(transactions.map((t) => t.date)).toEqual(['2026-08-31', '2026-09-30']);
    expect(recurring[0].lastGenerated).toBe('2026-09');
    const again = generateRecurring(recurring, '2026-10-31');
    expect(again.transactions.map((t) => t.date)).toEqual(['2026-10-31']);
  });
  it('skips inactive', () => {
    expect(generateRecurring([{ ...r, active: false }], '2026-10-25').transactions).toHaveLength(0);
  });
});

describe('summary', () => {
  const txs = [
    tx({ kind: 'expense', group: 'living', amount: 1000, date: '2026-10-02' }),
    tx({ kind: 'expense', group: 'personal', amount: 500, date: '2026-10-02' }),
    tx({ kind: 'lend', person: '田中', amount: 3000, date: '2026-10-03' }),
    tx({ kind: 'repay', person: '田中', amount: 1000, date: '2026-10-10' }),
    tx({ kind: 'keiba', amount: 2000, payout: 5000, date: '2026-10-11' }),
  ];
  it('month totals include lending and keiba purchase', () => {
    const s = summarizeMonth(txs, '2026-10');
    expect(s.totalOut).toBe(6500);
    expect(s.balance).toBe(1000 + 5000 - 6500);
  });
  it('daily includes lending', () => {
    expect(dailyBreakdown(txs, '2026-10')[2].lend).toBe(3000);
  });
  it('outstanding per person', () => {
    expect(lendingByPerson(txs)[0]).toMatchObject({ person: '田中', lent: 3000, repaid: 1000, outstanding: 2000 });
  });
});
