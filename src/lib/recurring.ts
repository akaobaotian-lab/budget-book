import type { Recurring, Transaction } from '../types';
import { addMonths, dateInMonth, monthOf, today as todayFn } from './date';
import { uid } from './format';

/**
 * 有効な固定費について、未記入の月の明細を作成する。
 * 支払日を過ぎた月だけ記入し、記入済みの月は lastGenerated で管理する
 * （自動記入された明細を削除しても再作成されない）。
 */
export function generateRecurring(
  recurring: Recurring[],
  today: string = todayFn(),
): { transactions: Transaction[]; recurring: Recurring[] } {
  const created: Transaction[] = [];
  const thisMonth = monthOf(today);

  const updated = recurring.map((r) => {
    if (!r.active) return r;
    let month = r.lastGenerated ? addMonths(r.lastGenerated, 1) : r.startMonth;
    let last = r.lastGenerated;
    while (month <= thisMonth) {
      const date = dateInMonth(month, r.day);
      if (date > today) break;
      created.push({
        id: uid(),
        date,
        kind: r.kind,
        amount: r.amount,
        memo: r.name,
        source: 'recurring',
        createdAt: Date.now(),
        recurringId: r.id,
        ...(r.kind === 'expense'
          ? { group: r.group ?? 'living', category: r.category ?? 'その他' }
          : { incomeType: r.incomeType ?? 'other' }),
      });
      last = month;
      month = addMonths(month, 1);
    }
    return last === r.lastGenerated ? r : { ...r, lastGenerated: last };
  });

  return { transactions: created, recurring: updated };
}
