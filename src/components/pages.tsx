import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { useStore } from '../store';
import { addMonths, currentMonth, formatMonth } from '../lib/date';
import { signedYen, yen } from '../lib/format';
import { categoryBreakdown, dailyBreakdown, inMonth, keibaSummary, lendingByPerson, sortByDateDesc, summarizeMonth } from '../lib/summary';
import { estimateTax } from '../lib/tax';
import { BarChart, COLORS, CategoryDoughnut } from './charts';
import { TxList } from './TxList';
import { KIND_LABEL } from '../lib/categories';

export type Tab = 'home' | 'list' | 'report' | 'lending' | 'keiba' | 'tax' | 'recurring' | 'settings';

interface PageProps {
  month: string;
  onEdit(t: Transaction): void;
  onAdd(kind?: Transaction['kind'], mode?: 'manual' | 'voice' | 'receipt'): void;
  go(tab: Tab): void;
}

export function MonthPicker({ month, setMonth }: { month: string; setMonth(m: string): void }) {
  return (
    <div className="month-picker">
      <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="前の月">‹</button>
      <strong>{formatMonth(month)}</strong>
      <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="次の月">›</button>
      {month !== currentMonth() && (
        <button type="button" className="link" onClick={() => setMonth(currentMonth())}>今月</button>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{color && <i className="swatch" style={{ background: color }} />}{label}</span>
      <strong>{value}</strong>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}

/* ---------------- ホーム ---------------- */

export function HomePage({ month, onEdit, onAdd, go }: PageProps) {
  const { data } = useStore();
  const txs = data.transactions;
  const s = useMemo(() => summarizeMonth(txs, month), [txs, month]);
  const daily = useMemo(() => dailyBreakdown(txs, month), [txs, month]);
  const year = Number(month.slice(0, 4));
  const tax = useMemo(() => estimateTax(txs, year, data.settings.tax), [txs, year, data.settings.tax]);
  const recent = useMemo(() => sortByDateDesc(inMonth(txs, month)).slice(0, 8), [txs, month]);

  return (
    <div className="page">
      <section className="card hero">
        <span className="muted">{formatMonth(month)}の支出総額</span>
        <strong className="hero-num">{yen(s.totalOut)}</strong>
        <div className="hero-sub">
          <span>収入 {yen(s.income)}</span>
          <span className={s.balance >= 0 ? 'plus' : 'minus'}>収支 {signedYen(s.balance)}</span>
        </div>
        <div className="stats">
          <Stat label="自分の買い物" value={yen(s.personal)} color={COLORS.personal} />
          <Stat label="生活費" value={yen(s.living)} color={COLORS.living} />
          <Stat label="貸したお金" value={yen(s.lend)} color={COLORS.lend} sub={s.repay ? `返済 ${yen(s.repay)}` : undefined} />
          <Stat label="競馬（購入）" value={yen(s.keibaPurchase)} color={COLORS.keiba} sub={s.keibaPurchase || s.keibaPayout ? `収支 ${signedYen(s.keibaPayout - s.keibaPurchase)}` : undefined} />
        </div>
      </section>

      {tax.taxOccurred && (
        <button type="button" className={`card alert ${tax.filingExempt ? 'soft' : ''}`} onClick={() => go('tax')}>
          <strong>
            {tax.filingExempt
              ? `💡 ${year}年の副業所得に住民税 約${yen(tax.residentTax)} が発生しています`
              : `⚠️ ${year}年の副業・競馬の所得で税金が発生しています：約${yen(tax.total)}`}
          </strong>
          <small>
            {tax.filingExempt
              ? `所得税の申告ラインまで あと${yen(tax.remainingToThreshold)}（住民税の申告は必要です）`
              : `所得税 約${yen(tax.incomeTax)} ／ 住民税 約${yen(tax.residentTax)}（確定申告が必要です）`}
          </small>
        </button>
      )}

      <div className="quick">
        <button type="button" className="btn" onClick={() => onAdd('expense', 'voice')}>🎤 音声で入力</button>
        <button type="button" className="btn" onClick={() => onAdd('expense', 'receipt')}>📷 レシート</button>
        <button type="button" className="btn" onClick={() => go('settings')}>✉️ Gmail取り込み</button>
      </div>

      <section className="card">
        <h3>日別の支出</h3>
        <BarChart
          stacked
          labels={daily.map((d) => String(d.day))}
          series={[
            { label: '生活費', data: daily.map((d) => d.living), color: COLORS.living },
            { label: '自分の買い物', data: daily.map((d) => d.personal), color: COLORS.personal },
            { label: '貸したお金', data: daily.map((d) => d.lend), color: COLORS.lend },
            { label: '競馬', data: daily.map((d) => d.keiba), color: COLORS.keiba },
          ]}
        />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>最近の明細</h3>
          <button type="button" className="link" onClick={() => go('list')}>すべて見る ›</button>
        </div>
        <TxList items={recent} onEdit={onEdit} />
      </section>
    </div>
  );
}

/* ---------------- 明細 ---------------- */

type Filter = 'all' | 'personal' | 'living' | 'income' | 'lend' | 'keiba';
const FILTERS: [Filter, string][] = [
  ['all', 'すべて'], ['personal', '自分'], ['living', '生活費'], ['income', '収入'], ['lend', '貸し借り'], ['keiba', '競馬'],
];

export function ListPage({ month, onEdit }: PageProps) {
  const { data } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [asc, setAsc] = useState(false);

  const items = useMemo(() => {
    let list = inMonth(data.transactions, month).filter((t) => {
      switch (filter) {
        case 'personal': return t.kind === 'expense' && t.group !== 'living';
        case 'living': return t.kind === 'expense' && t.group === 'living';
        case 'income': return t.kind === 'income';
        case 'lend': return t.kind === 'lend' || t.kind === 'repay';
        case 'keiba': return t.kind === 'keiba';
        default: return true;
      }
    });
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((t) => [t.memo, t.category, t.person].some((v) => v?.toLowerCase().includes(k)));
    }
    const sorted = sortByDateDesc(list);
    return asc ? sorted.reverse() : sorted;
  }, [data.transactions, month, filter, q, asc]);

  return (
    <div className="page">
      <div className="toolbar">
        <div className="chips scroll">
          {FILTERS.map(([k, l]) => (
            <button type="button" key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="row">
          <input className="grow" type="search" placeholder="メモ・店名・相手で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn" onClick={() => setAsc(!asc)}>{asc ? '古い順 ↑' : '新しい順 ↓'}</button>
        </div>
      </div>
      <section className="card">
        <TxList items={items} onEdit={onEdit} />
      </section>
    </div>
  );
}

/* ---------------- 集計 ---------------- */

export function ReportPage({ month }: PageProps) {
  const { data } = useStore();
  const txs = data.transactions;
  const [scope, setScope] = useState<'month' | 'year'>('month');
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)), [month]);
  const sums = useMemo(() => months.map((m) => summarizeMonth(txs, m)), [txs, months]);
  const year = month.slice(0, 4);
  const cats = useMemo(
    () => categoryBreakdown(scope === 'month' ? inMonth(txs, month) : txs.filter((t) => t.date.startsWith(year)), null),
    [txs, month, scope, year],
  );
  const groupCats = (group: 'personal' | 'living') =>
    categoryBreakdown(inMonth(txs, month).filter((t) => t.kind === 'expense' && (t.group ?? 'personal') === group), null);

  return (
    <div className="page">
      <section className="card">
        <h3>月ごとの支出（直近12か月）</h3>
        <BarChart
          stacked
          height={260}
          labels={months.map((m) => `${Number(m.slice(5))}月`)}
          series={[
            { label: '生活費', data: sums.map((s) => s.living), color: COLORS.living },
            { label: '自分の買い物', data: sums.map((s) => s.personal), color: COLORS.personal },
            { label: '貸したお金', data: sums.map((s) => s.lend), color: COLORS.lend },
            { label: '競馬', data: sums.map((s) => s.keibaPurchase), color: COLORS.keiba },
          ]}
        />
      </section>

      <section className="card">
        <h3>月ごとの収入と支出</h3>
        <BarChart
          labels={months.map((m) => `${Number(m.slice(5))}月`)}
          series={[
            { label: '収入', data: sums.map((s) => s.income), color: COLORS.income },
            { label: '支出', data: sums.map((s) => s.totalOut), color: COLORS.out },
          ]}
        />
        <table className="table">
          <thead><tr><th>月</th><th>収入</th><th>支出</th><th>収支</th></tr></thead>
          <tbody>
            {months.slice().reverse().map((m, i) => {
              const s = sums[11 - i];
              return (
                <tr key={m}>
                  <td>{formatMonth(m)}</td>
                  <td className="num">{yen(s.income)}</td>
                  <td className="num">{yen(s.totalOut)}</td>
                  <td className={`num ${s.balance >= 0 ? 'plus' : 'minus'}`}>{signedYen(s.balance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>カテゴリ別の支出</h3>
          <div className="seg small">
            <button type="button" className={scope === 'month' ? 'on' : ''} onClick={() => setScope('month')}>{Number(month.slice(5))}月</button>
            <button type="button" className={scope === 'year' ? 'on' : ''} onClick={() => setScope('year')}>{year}年</button>
          </div>
        </div>
        <CategoryDoughnut items={cats} />
      </section>

      <div className="grid2">
        <section className="card">
          <h3>自分の買い物（{Number(month.slice(5))}月）</h3>
          <CategoryList items={groupCats('personal')} />
        </section>
        <section className="card">
          <h3>生活費（{Number(month.slice(5))}月）</h3>
          <CategoryList items={groupCats('living')} />
        </section>
      </div>
    </div>
  );
}

function CategoryList({ items }: { items: { category: string; amount: number }[] }) {
  if (!items.length) return <p className="empty">データがありません</p>;
  const max = items[0].amount;
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.category}>
          <span>{i.category}</span>
          <span className="bar"><i style={{ width: `${(i.amount / max) * 100}%` }} /></span>
          <span className="num">{yen(i.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- 貸し借り ---------------- */

export function LendingPage({ onEdit, onAdd }: PageProps) {
  const { data } = useStore();
  const people = useMemo(() => lendingByPerson(data.transactions), [data.transactions]);
  const [open, setOpen] = useState<string | null>(null);
  const totalOutstanding = people.reduce((a, p) => a + Math.max(0, p.outstanding), 0);

  return (
    <div className="page">
      <section className="card hero">
        <span className="muted">未返済残高の合計</span>
        <strong className="hero-num">{yen(totalOutstanding)}</strong>
        <div className="quick">
          <button type="button" className="btn primary" onClick={() => onAdd('lend')}>＋ 貸した</button>
          <button type="button" className="btn" onClick={() => onAdd('repay')}>＋ 返ってきた</button>
        </div>
      </section>

      {people.length === 0 && <p className="empty">まだ貸し借りの記録はありません</p>}

      {people.map((p) => (
        <section key={p.person} className="card person">
          <button type="button" className="person-head" onClick={() => setOpen(open === p.person ? null : p.person)}>
            <span className="avatar">{p.person.slice(0, 1)}</span>
            <span className="grow">
              <strong>{p.person}さん</strong>
              <small className="muted">貸した {yen(p.lent)} ／ 返済 {yen(p.repaid)}</small>
            </span>
            <span className={`outstanding ${p.outstanding > 0 ? 'minus' : 'done'}`}>
              {p.outstanding > 0 ? <>残り<br /><strong>{yen(p.outstanding)}</strong></> : p.outstanding < 0 ? `${yen(-p.outstanding)} 多く返済` : '完済'}
            </span>
          </button>
          {p.lent > 0 && (
            <div className="bar repay-bar"><i style={{ width: `${Math.min(100, (p.repaid / p.lent) * 100)}%` }} /></div>
          )}
          {open === p.person && (
            <>
              <h4>履歴</h4>
              <table className="table history">
                <thead><tr><th>日付</th><th>内容</th><th>金額</th><th>残高</th></tr></thead>
                <tbody>
                  {(() => {
                    let bal = 0;
                    const rows = [...p.history].reverse().map((t) => {
                      bal += t.kind === 'lend' ? t.amount : -t.amount;
                      return { t, bal };
                    });
                    return rows.reverse().map(({ t, bal }) => (
                      <tr key={t.id} onClick={() => onEdit(t)} className="clickable">
                        <td>{t.date.replace(/-/g, '/')}</td>
                        <td>{KIND_LABEL[t.kind]}{t.memo ? `（${t.memo}）` : ''}</td>
                        <td className={`num ${t.kind === 'lend' ? 'minus' : 'plus'}`}>{t.kind === 'lend' ? '' : '-'}{yen(t.amount)}</td>
                        <td className="num">{yen(bal)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </>
          )}
        </section>
      ))}
    </div>
  );
}

/* ---------------- 競馬 ---------------- */

export function KeibaPage({ month, onEdit, onAdd }: PageProps) {
  const { data } = useStore();
  const year = month.slice(0, 4);
  const m = useMemo(() => keibaSummary(data.transactions, month), [data.transactions, month]);
  const y = useMemo(() => keibaSummary(data.transactions, year), [data.transactions, year]);
  const items = useMemo(() => sortByDateDesc(inMonth(data.transactions, month).filter((t) => t.kind === 'keiba')), [data.transactions, month]);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const monthly = months.map((mm) => keibaSummary(data.transactions, mm));

  const Block = ({ title, s }: { title: string; s: ReturnType<typeof keibaSummary> }) => (
    <section className="card">
      <h3>{title}</h3>
      <div className="stats three">
        <Stat label="購入額" value={yen(s.purchase)} />
        <Stat label="払戻額" value={yen(s.payout)} />
        <Stat label="収支" value={signedYen(s.net)} />
      </div>
      <p className="muted small">回収率 {(s.recovery * 100).toFixed(1)}% ・ {s.count}件中 {s.hits}件で払戻</p>
    </section>
  );

  return (
    <div className="page">
      <p className="hint">競馬は生活費とは別に管理します。購入額は日別支出に含まれ、払戻は収支に反映されます。</p>
      <Block title={`${formatMonth(month)}の競馬`} s={m} />
      <Block title={`${year}年の競馬`} s={y} />
      <section className="card">
        <h3>{year}年 月別の購入・払戻</h3>
        <BarChart
          labels={months.map((mm) => `${Number(mm.slice(5))}月`)}
          series={[
            { label: '購入額', data: monthly.map((s) => s.purchase), color: COLORS.keiba },
            { label: '払戻額', data: monthly.map((s) => s.payout), color: COLORS.living },
          ]}
        />
      </section>
      <section className="card">
        <div className="card-head">
          <h3>{formatMonth(month)}の記録</h3>
          <button type="button" className="btn primary" onClick={() => onAdd('keiba')}>＋ 記録</button>
        </div>
        <TxList items={items} onEdit={onEdit} />
      </section>
    </div>
  );
}
