import type { Transaction } from '../types';
import { daysInMonth } from './date';

export interface MonthSummary {
  /** 支出総額（自分 + 生活費 + 貸した + 競馬購入） */
  totalOut: number;
  personal: number;
  living: number;
  lend: number;
  keibaPurchase: number;
  keibaPayout: number;
  /** 収入（給与・副業・その他。返済・競馬払戻は含まない） */
  income: number;
  repay: number;
  /** 収入 + 返済 + 払戻 − 支出総額 */
  balance: number;
}

export function inMonth(txs: Transaction[], month: string): Transaction[] {
  return txs.filter((t) => t.date.startsWith(month));
}

/** 日別支出に含めるかどうか（貸したお金・競馬購入も含める） */
export function outflow(t: Transaction): number {
  return t.kind === 'expense' || t.kind === 'lend' || t.kind === 'keiba' ? t.amount : 0;
}

export function summarizeMonth(txs: Transaction[], month: string): MonthSummary {
  const s: MonthSummary = {
    totalOut: 0, personal: 0, living: 0, lend: 0, keibaPurchase: 0, keibaPayout: 0, income: 0, repay: 0, balance: 0,
  };
  for (const t of inMonth(txs, month)) {
    switch (t.kind) {
      case 'expense':
        if (t.group === 'living') s.living += t.amount;
        else s.personal += t.amount;
        break;
      case 'lend':
        s.lend += t.amount;
        break;
      case 'keiba':
        s.keibaPurchase += t.amount;
        s.keibaPayout += t.payout ?? 0;
        break;
      case 'income':
        s.income += t.amount;
        break;
      case 'repay':
        s.repay += t.amount;
        break;
    }
  }
  s.totalOut = s.personal + s.living + s.lend + s.keibaPurchase;
  s.balance = s.income + s.repay + s.keibaPayout - s.totalOut;
  return s;
}

export interface DailyRow {
  day: number;
  personal: number;
  living: number;
  lend: number;
  keiba: number;
}

export function dailyBreakdown(txs: Transaction[], month: string): DailyRow[] {
  const rows: DailyRow[] = Array.from({ length: daysInMonth(month) }, (_, i) => ({
    day: i + 1, personal: 0, living: 0, lend: 0, keiba: 0,
  }));
  for (const t of inMonth(txs, month)) {
    const row = rows[Number(t.date.slice(8, 10)) - 1];
    if (!row) continue;
    if (t.kind === 'expense') row[t.group === 'living' ? 'living' : 'personal'] += t.amount;
    else if (t.kind === 'lend') row.lend += t.amount;
    else if (t.kind === 'keiba') row.keiba += t.amount;
  }
  return rows;
}

export function categoryBreakdown(txs: Transaction[], month: string | null): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of month ? inMonth(txs, month) : txs) {
    if (t.kind !== 'expense') continue;
    const c = t.category || 'その他';
    map.set(c, (map.get(c) ?? 0) + t.amount);
  }
  return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export interface PersonBalance {
  person: string;
  lent: number;
  repaid: number;
  outstanding: number;
  history: Transaction[];
  lastDate: string;
}

/** 相手ごとの貸し借り集計 */
export function lendingByPerson(txs: Transaction[]): PersonBalance[] {
  const map = new Map<string, PersonBalance>();
  for (const t of txs) {
    if (t.kind !== 'lend' && t.kind !== 'repay') continue;
    const person = (t.person || '(名前なし)').trim();
    const p = map.get(person) ?? { person, lent: 0, repaid: 0, outstanding: 0, history: [], lastDate: '' };
    if (t.kind === 'lend') p.lent += t.amount;
    else p.repaid += t.amount;
    p.history.push(t);
    if (t.date > p.lastDate) p.lastDate = t.date;
    map.set(person, p);
  }
  for (const p of map.values()) {
    p.outstanding = p.lent - p.repaid;
    p.history.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding || b.lastDate.localeCompare(a.lastDate));
}

export function keibaSummary(txs: Transaction[], prefix: string) {
  let purchase = 0;
  let payout = 0;
  let count = 0;
  let hits = 0;
  for (const t of txs) {
    if (t.kind !== 'keiba' || !t.date.startsWith(prefix)) continue;
    purchase += t.amount;
    payout += t.payout ?? 0;
    count++;
    if ((t.payout ?? 0) > 0) hits++;
  }
  return { purchase, payout, net: payout - purchase, count, hits, recovery: purchase ? payout / purchase : 0 };
}

export function sortByDateDesc(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
