import type { ExpenseGroup, IncomeType, Kind } from '../types';
import { defaultGroupFor, findCategoryName, guessCategory } from './categories';
import { makeDate, shiftDays, today as todayFn } from './date';
import { extractYenAmounts, normalizeWidth, parseJapaneseNumber } from './japaneseNumber';

export interface ParsedEntry {
  kind: Kind;
  date: string;
  amount: number | null;
  memo: string;
  group?: ExpenseGroup;
  category?: string;
  incomeType?: IncomeType;
  person?: string;
  payout?: number;
}

const DATE_WORDS: [RegExp, number][] = [
  [/一昨日|おととい/, -2],
  [/昨日|きのう/, -1],
  [/今日|きょう|本日/, 0],
];

function parseDate(text: string, base: string): { date: string; rest: string } {
  for (const [re, delta] of DATE_WORDS) {
    if (re.test(text)) return { date: shiftDays(base, delta), rest: text.replace(re, '') };
  }
  const [by, bm] = base.split('-').map(Number);
  const NUM = '(\\d{1,2}|[一二三四五六七八九十]+)';
  const full = text.match(new RegExp(`(?:(\\d{4})年)?${NUM}月${NUM}日`));
  if (full) {
    const y = full[1] ? Number(full[1]) : by;
    const m = parseJapaneseNumber(full[2]) ?? bm;
    const d = parseJapaneseNumber(full[3]) ?? 1;
    const date = makeDate(y, m, d);
    if (date) return { date, rest: text.replace(full[0], '') };
  }
  const slash = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const date = makeDate(by, Number(slash[1]), Number(slash[2]));
    if (date) return { date, rest: text.replace(slash[0], '') };
  }
  const dayOnly = text.match(new RegExp(`${NUM}日`));
  if (dayOnly) {
    const date = makeDate(by, bm, parseJapaneseNumber(dayOnly[1]) ?? 1);
    if (date) return { date, rest: text.replace(dayOnly[0], '') };
  }
  return { date: base, rest: text };
}

const HONORIFIC = '(?:さん|くん|君|ちゃん|様|氏)?';

function extractPerson(text: string, particle: string): string | undefined {
  const m = text.match(new RegExp(`([^\\s、。,]+?)${HONORIFIC}${particle}`));
  if (!m) return undefined;
  // 「居酒屋で田中」のように前置きが付いた場合は最後の語を名前とみなす
  const parts = m[1].split(/[\s、。,]|で|は|が|を|に/).filter(Boolean);
  const name = parts[parts.length - 1]?.replace(/(さん|くん|君|ちゃん|様|氏)$/, '');
  return name || undefined;
}

function cleanMemo(text: string): string {
  return text
    .replace(/[¥]?\s*[\d,.〇零一二三四五六七八九十百千万億]+\s*円/g, '')
    .replace(/(自分の買い物|自分用|生活費|で|を|に)?(使った|払った|買った|支払った|購入した)$/g, '')
    .replace(/[、。\s]+/g, ' ')
    .trim();
}

/**
 * 音声入力の文字列から明細を推定する。
 * 例:「昨日スーパーで食費2500円」「田中さんに5000円貸した」「競馬で3000円買って払い戻し1万円」
 */
export function parseVoiceText(input: string, base: string = todayFn()): ParsedEntry {
  const text = normalizeWidth(input).trim();
  const { date, rest } = parseDate(text, base);
  let amounts = extractYenAmounts(rest);
  // 「円」が聞き取れなかった場合は数字だけを金額とみなす
  if (amounts.length === 0) {
    amounts = [...rest.matchAll(/\d[\d,]*/g)].map((m) => ({ value: Number(m[0].replace(/,/g, '')), index: m.index ?? 0, raw: m[0] }));
  }
  const first = amounts[0]?.value ?? null;

  // 競馬
  if (/競馬|馬券|レース|WIN5|ウインファイブ/i.test(rest)) {
    let purchase: number | null = null;
    let payout: number | undefined;
    for (const a of amounts) {
      const before = rest.slice(Math.max(0, a.index - 8), a.index);
      if (/払い?戻し?|配当|当た|的中|払戻/.test(before)) payout = a.value;
      else if (purchase == null) purchase = a.value;
    }
    return { kind: 'keiba', date, amount: purchase ?? 0, payout, memo: cleanMemo(rest.replace(/払い?戻し?|配当/g, '')) };
  }

  // 返済を受けた
  if (/(から).*(返して|返済|返って|戻って|返金)/.test(rest)) {
    return { kind: 'repay', date, amount: first, person: extractPerson(rest, 'から'), memo: '' };
  }

  // 貸した
  if (/貸し|貸す|立て替え|立替/.test(rest)) {
    const person = extractPerson(rest, '(?:に|へ|の分)');
    const withoutPerson = person ? rest.replace(new RegExp(`${person}${HONORIFIC}(?:に|へ|の分)`), '') : rest;
    return {
      kind: 'lend',
      date,
      amount: first,
      person,
      memo: cleanMemo(withoutPerson.replace(/(を|に)?(貸した|貸し|立て替えた|立て替え|立替)/g, '')).replace(/で$/, ''),
    };
  }

  // 収入
  if (/給料|給与|ボーナス|賞与/.test(rest)) {
    return { kind: 'income', date, amount: first, incomeType: 'salary', memo: cleanMemo(rest.replace(/(が)?(入った|入金|振込|もらった)/g, '')) };
  }
  if (/副業|報酬|案件|業務委託|原稿料|売上/.test(rest)) {
    return { kind: 'income', date, amount: first, incomeType: 'side', memo: cleanMemo(rest.replace(/(が)?(入った|入金|振込|もらった)|収入/g, '')) };
  }
  if (/収入|入金|振り?込/.test(rest)) {
    return { kind: 'income', date, amount: first, incomeType: 'other', memo: cleanMemo(rest.replace(/(が)?(入った|入金|振り?込み?|もらった)|収入/g, '')) };
  }

  // 支出
  const category = findCategoryName(rest) ?? guessCategory(rest);
  let group: ExpenseGroup = defaultGroupFor(category);
  if (/生活費/.test(rest)) group = 'living';
  if (/自分/.test(rest)) group = 'personal';
  const memo = cleanMemo(rest.replace(/生活費|自分の買い物|自分用/g, '').replace(new RegExp(category, 'g'), ''));
  return { kind: 'expense', date, amount: first, group, category, memo };
}
