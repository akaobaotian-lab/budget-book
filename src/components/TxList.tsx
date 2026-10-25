import type { Transaction } from '../types';
import { GROUP_LABEL, INCOME_LABEL, KIND_LABEL } from '../lib/categories';
import { formatDate } from '../lib/date';
import { yen } from '../lib/format';
import { outflow } from '../lib/summary';

const SOURCE_ICON: Record<Transaction['source'], string> = {
  manual: '',
  voice: '🎤',
  receipt: '📷',
  gmail: '✉️',
  recurring: '🔁',
};

export function txTitle(t: Transaction): string {
  switch (t.kind) {
    case 'lend':
      return `${t.person}さんに貸した${t.memo ? `（${t.memo}）` : ''}`;
    case 'repay':
      return `${t.person}さんから返済${t.memo ? `（${t.memo}）` : ''}`;
    case 'keiba':
      return t.memo || '競馬';
    case 'income':
      return t.memo || INCOME_LABEL[t.incomeType ?? 'other'];
    default:
      return t.memo || t.category || '支出';
  }
}

function tag(t: Transaction): string {
  if (t.kind === 'expense') return `${GROUP_LABEL[t.group ?? 'personal']}・${t.category ?? 'その他'}${t.sideExpense ? '・副業経費' : ''}`;
  if (t.kind === 'income') return INCOME_LABEL[t.incomeType ?? 'other'];
  return KIND_LABEL[t.kind];
}

function TxAmount({ t }: { t: Transaction }) {
  if (t.kind === 'keiba') {
    const net = (t.payout ?? 0) - t.amount;
    return (
      <span className="tx-amount keiba">
        <span className="minus">-{yen(t.amount)}</span>
        {(t.payout ?? 0) > 0 && <span className="plus">払戻 {yen(t.payout!)}</span>}
        <small className={net >= 0 ? 'plus' : 'minus'}>収支 {net >= 0 ? '+' : ''}{yen(net)}</small>
      </span>
    );
  }
  const plus = t.kind === 'income' || t.kind === 'repay';
  return <span className={`tx-amount ${plus ? 'plus' : 'minus'}`}>{plus ? '+' : '-'}{yen(t.amount)}</span>;
}

export function TxList({ items, onEdit, groupByDate = true }: { items: Transaction[]; onEdit(t: Transaction): void; groupByDate?: boolean }) {
  if (items.length === 0) return <p className="empty">明細はまだありません</p>;

  const groups: { date: string; items: Transaction[] }[] = [];
  for (const t of items) {
    const last = groups[groups.length - 1];
    if (groupByDate && last?.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <div className="tx-list">
      {groups.map((g, i) => (
        <section key={g.date + i} className="tx-day">
          {groupByDate && (
            <header>
              <span>{formatDate(g.date)}</span>
              <span className="muted">支出 {yen(g.items.reduce((a, t) => a + outflow(t), 0))}</span>
            </header>
          )}
          <ul>
            {g.items.map((t) => (
              <li key={t.id}>
                <button type="button" className="tx" onClick={() => onEdit(t)}>
                  <span className={`dot kind-${t.kind} ${t.kind === 'expense' ? `group-${t.group}` : ''}`} />
                  <span className="tx-main">
                    <span className="tx-title">{txTitle(t)} {SOURCE_ICON[t.source] && <small>{SOURCE_ICON[t.source]}</small>}</span>
                    {t.items?.length ? (
                      <small className="tx-items">🛒 {t.items[0]}{t.items.length > 1 ? ` ほか${t.items.length - 1}点` : ''}</small>
                    ) : null}
                    <small className="muted">{!groupByDate && `${formatDate(t.date)} ・ `}{tag(t)}{t.detail ? ` ・ ${t.detail}` : ''}</small>
                  </span>
                  <TxAmount t={t} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
