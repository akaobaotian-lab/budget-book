import { useState } from 'react';
import type { ExpenseGroup, IncomeType, Recurring } from '../types';
import { useStore } from '../store';
import { EXPENSE_CATEGORIES, GROUP_LABEL, INCOME_LABEL, defaultGroupFor } from '../lib/categories';
import { addMonths, currentMonth, formatMonth } from '../lib/date';
import { uid, yen } from '../lib/format';

const empty = (): Recurring => ({
  id: uid(), name: '', amount: 0, day: 27, kind: 'expense', group: 'living', category: '住居', active: true, startMonth: currentMonth(),
});

/** 再開：停止中の月はさかのぼらず、今月分から記入する */
function resume(r: Recurring): Recurring {
  const prev = addMonths(currentMonth(), -1);
  if (!r.lastGenerated) return { ...r, active: true, startMonth: r.startMonth > currentMonth() ? r.startMonth : currentMonth() };
  return { ...r, active: true, lastGenerated: r.lastGenerated < prev ? prev : r.lastGenerated };
}

export function RecurringPage() {
  const { data, saveRecurring, deleteRecurring } = useStore();
  const [editing, setEditing] = useState<Recurring | null>(null);
  const list = [...data.recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.day - b.day);
  const monthlyTotal = data.recurring.filter((r) => r.active && r.kind === 'expense').reduce((a, r) => a + r.amount, 0);

  return (
    <div className="page">
      <section className="card hero">
        <span className="muted">毎月の固定費（登録中）</span>
        <strong className="hero-num">{yen(monthlyTotal)}</strong>
        <small className="muted">支払日になると自動で明細に記入されます</small>
        <div className="quick"><button type="button" className="btn primary" onClick={() => setEditing(empty())}>＋ 固定費を登録</button></div>
      </section>

      {editing && <RecurringForm value={editing} onCancel={() => setEditing(null)} onSave={(r) => { saveRecurring(r); setEditing(null); }} />}

      <section className="card">
        {list.length === 0 && <p className="empty">固定費は登録されていません（家賃・サブスク・保険など）</p>}
        <ul className="rec-list">
          {list.map((r) => (
            <li key={r.id} className={r.active ? '' : 'inactive'}>
              <div className="grow">
                <strong>{r.name}</strong>
                <small className="muted">
                  毎月{r.day >= 31 ? '末日' : `${r.day}日`} ・ {r.kind === 'expense' ? `${GROUP_LABEL[r.group ?? 'living']}・${r.category}` : `収入・${INCOME_LABEL[r.incomeType ?? 'other']}`}
                  {r.lastGenerated && ` ・ ${formatMonth(r.lastGenerated)}まで記入済み`}
                </small>
              </div>
              <span className={`num ${r.kind === 'income' ? 'plus' : ''}`}>{yen(r.amount)}</span>
              <div className="rec-actions">
                <button type="button" className="btn small" onClick={() => setEditing(r)}>編集</button>
                <button
                  type="button"
                  className={`btn small ${r.active ? '' : 'primary'}`}
                  onClick={() => saveRecurring(r.active ? { ...r, active: false } : resume(r))}
                >
                  {r.active ? '解除' : '再開'}
                </button>
                <button type="button" className="btn small danger" onClick={() => confirm(`「${r.name}」を削除しますか？（記入済みの明細は残ります）`) && deleteRecurring(r.id)}>削除</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="hint">「解除」するとそれ以降は自動記入されません（記入済みの明細は残ります）。「再開」すると今月分から記入され、停止中の月はさかのぼって記入されません。</p>
    </div>
  );
}

function RecurringForm({ value, onSave, onCancel }: { value: Recurring; onSave(r: Recurring): void; onCancel(): void }) {
  const [r, setR] = useState(value);
  const [error, setError] = useState('');
  const set = (patch: Partial<Recurring>) => setR((p) => ({ ...p, ...patch }));

  return (
    <section className="card">
      <h3>{value.name ? '固定費を編集' : '固定費を登録'}</h3>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!r.name.trim()) return setError('名前を入力してください');
          if (r.amount <= 0) return setError('金額を入力してください');
          onSave({ ...r, name: r.name.trim() });
        }}
      >
        <div className="seg small">
          <button type="button" className={r.kind === 'expense' ? 'on' : ''} onClick={() => set({ kind: 'expense' })}>支出</button>
          <button type="button" className={r.kind === 'income' ? 'on' : ''} onClick={() => set({ kind: 'income', incomeType: r.incomeType ?? 'salary' })}>収入</button>
        </div>
        <label>名前<input value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder="例: 家賃、Netflix、スマホ代" /></label>
        <label>
          金額
          <div className="yen-input"><span>¥</span><input inputMode="numeric" value={r.amount || ''} onChange={(e) => set({ amount: Number(e.target.value.replace(/,/g, '')) || 0 })} /></div>
        </label>
        <label>
          毎月の支払日
          <select value={r.day} onChange={(e) => set({ day: Number(e.target.value) })}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? '末日' : `${d}日`}</option>)}
          </select>
        </label>
        {r.kind === 'expense' ? (
          <>
            <label>
              カテゴリ
              <select value={r.category} onChange={(e) => set({ category: e.target.value, group: defaultGroupFor(e.target.value) })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="seg small">
              {(Object.keys(GROUP_LABEL) as ExpenseGroup[]).map((g) => (
                <button type="button" key={g} className={r.group === g ? 'on' : ''} onClick={() => set({ group: g })}>{GROUP_LABEL[g]}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="seg small">
            {(Object.keys(INCOME_LABEL) as IncomeType[]).map((t) => (
              <button type="button" key={t} className={r.incomeType === t ? 'on' : ''} onClick={() => set({ incomeType: t })}>{INCOME_LABEL[t]}</button>
            ))}
          </div>
        )}
        {!value.lastGenerated && (
          <label>
            記入を始める月
            <input type="month" value={r.startMonth} onChange={(e) => set({ startMonth: e.target.value })} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <span className="grow" />
          <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="btn primary">保存</button>
        </div>
      </form>
    </section>
  );
}
