import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExpenseGroup, IncomeType, Kind, Source, Transaction } from '../types';
import { EXPENSE_CATEGORIES, GROUP_LABEL, INCOME_LABEL, KIND_LABEL, defaultGroupFor, guessCategory } from '../lib/categories';
import { today } from '../lib/date';
import { parseVoiceText } from '../lib/voiceParser';
import { useStore, type NewTransaction } from '../store';
import { VoiceButton } from './VoiceButton';
import { ReceiptScanner } from './ReceiptScanner';

interface Props {
  editing?: Transaction | null;
  initialKind?: Kind;
  initialMode?: 'manual' | 'voice' | 'receipt';
  onClose(): void;
}

interface FormState {
  kind: Kind;
  date: string;
  amount: string;
  memo: string;
  group: ExpenseGroup;
  category: string;
  sideExpense: boolean;
  incomeType: IncomeType;
  person: string;
  payout: string;
  hitCost: string;
  source: Source;
}

function fromTx(t: Transaction): FormState {
  return {
    kind: t.kind,
    date: t.date,
    amount: String(t.amount || ''),
    memo: t.memo,
    group: t.group ?? 'personal',
    category: t.category ?? 'その他',
    sideExpense: !!t.sideExpense,
    incomeType: t.incomeType ?? 'side',
    person: t.person ?? '',
    payout: t.payout ? String(t.payout) : '',
    hitCost: t.hitCost ? String(t.hitCost) : '',
    source: t.source,
  };
}

const blank = (kind: Kind): FormState => ({
  kind, date: today(), amount: '', memo: '', group: 'personal', category: '食費', sideExpense: false,
  incomeType: 'side', person: '', payout: '', hitCost: '', source: 'manual',
});

const KINDS: Kind[] = ['expense', 'income', 'lend', 'repay', 'keiba'];

const num = (s: string) => Math.max(0, Math.round(Number(s.replace(/[,，]/g, '')) || 0));

export function EntryForm({ editing, initialKind = 'expense', initialMode = 'manual', onClose }: Props) {
  const { data, addTransactions, updateTransaction, deleteTransaction } = useStore();
  const [f, setF] = useState<FormState>(() => (editing ? fromTx(editing) : blank(initialKind)));
  const [mode, setMode] = useState(editing ? 'manual' : initialMode);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const [categoryTouched, setCategoryTouched] = useState(!!editing);
  const amountRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const people = useMemo(
    () => [...new Set(data.transactions.filter((t) => t.person).map((t) => t.person!))].sort(),
    [data.transactions],
  );

  useEffect(() => {
    if (mode === 'manual') amountRef.current?.focus();
  }, [mode]);

  // メモからカテゴリを推定（ユーザーが手で選んだら上書きしない）
  const onMemo = (memo: string) => {
    setF((p) => {
      const next = { ...p, memo };
      if (!categoryTouched && p.kind === 'expense' && memo.trim()) {
        const c = guessCategory(memo);
        if (c !== 'その他') {
          next.category = c;
          next.group = defaultGroupFor(c);
        }
      }
      return next;
    });
  };

  const onVoice = (text: string) => {
    setHeard(text);
    const p = parseVoiceText(text);
    setF((prev) => ({
      ...prev,
      kind: p.kind,
      date: p.date,
      amount: p.amount ? String(p.amount) : prev.amount,
      memo: p.memo || prev.memo,
      group: p.group ?? prev.group,
      category: p.category ?? prev.category,
      incomeType: p.incomeType ?? prev.incomeType,
      person: p.person ?? prev.person,
      payout: p.payout ? String(p.payout) : prev.payout,
      source: 'voice',
    }));
    setCategoryTouched(true);
    setMode('manual');
  };

  const onReceipt = (r: { date: string | null; amount: number | null; store: string; category: string }) => {
    setF((prev) => ({
      ...prev,
      kind: 'expense',
      date: r.date ?? prev.date,
      amount: r.amount ? String(r.amount) : prev.amount,
      memo: r.store || prev.memo,
      category: r.category,
      group: defaultGroupFor(r.category),
      source: 'receipt',
    }));
    setCategoryTouched(true);
    setMode('manual');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = num(f.amount);
    if (f.kind !== 'keiba' && amount <= 0) return setError('金額を入力してください');
    if (f.kind === 'keiba' && amount <= 0 && num(f.payout) <= 0) return setError('購入額か払戻額を入力してください');
    if ((f.kind === 'lend' || f.kind === 'repay') && !f.person.trim()) return setError('相手の名前を入力してください');

    const tx: NewTransaction = { kind: f.kind, date: f.date, amount, memo: f.memo.trim(), source: f.source };
    if (f.kind === 'expense') Object.assign(tx, { group: f.group, category: f.category, sideExpense: f.sideExpense || undefined });
    if (f.kind === 'income') tx.incomeType = f.incomeType;
    if (f.kind === 'lend' || f.kind === 'repay') tx.person = f.person.trim();
    if (f.kind === 'keiba') {
      tx.payout = num(f.payout);
      tx.hitCost = num(f.hitCost) || undefined;
    }

    if (editing) {
      // 種類が変わった場合に古い項目が残らないようにする
      updateTransaction(editing.id, {
        group: undefined, category: undefined, sideExpense: undefined, incomeType: undefined,
        person: undefined, payout: undefined, hitCost: undefined, ...tx,
      });
    } else {
      addTransactions([tx]);
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="明細の入力" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{editing ? '明細を編集' : '明細を追加'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">✕</button>
        </header>

        {!editing && (
          <div className="seg" role="tablist">
            <button type="button" className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>✏️ 手入力</button>
            <button type="button" className={mode === 'voice' ? 'on' : ''} onClick={() => setMode('voice')}>🎤 音声</button>
            <button type="button" className={mode === 'receipt' ? 'on' : ''} onClick={() => setMode('receipt')}>📷 レシート</button>
          </div>
        )}

        {mode === 'voice' && <VoiceButton onResult={onVoice} />}
        {mode === 'receipt' && <ReceiptScanner onResult={onReceipt} />}

        {mode === 'manual' && (
          <form onSubmit={submit} className="form">
            {heard && <p className="hint">🎤「{heard}」から入力しました。内容を確認してください。</p>}
            {f.source === 'receipt' && !editing && <p className="hint">📷 レシートから読み取りました。内容を確認してください。</p>}

            <div className="chips">
              {KINDS.map((k) => (
                <button type="button" key={k} className={`chip kind-${k} ${f.kind === k ? 'on' : ''}`} onClick={() => set('kind', k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>

            <label>
              日付
              <input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
            </label>

            {(f.kind === 'lend' || f.kind === 'repay') && (
              <label>
                {f.kind === 'lend' ? '誰に貸した？' : '誰から返ってきた？'}
                <input list="people" value={f.person} onChange={(e) => set('person', e.target.value)} placeholder="名前" />
                <datalist id="people">{people.map((p) => <option key={p} value={p} />)}</datalist>
              </label>
            )}

            <label>
              {f.kind === 'keiba' ? '購入額' : f.kind === 'lend' ? '貸した金額' : f.kind === 'repay' ? '返ってきた金額' : '金額'}
              <div className="yen-input">
                <span>¥</span>
                <input ref={amountRef} inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" />
              </div>
            </label>

            {f.kind === 'keiba' && (
              <>
                <label>
                  払戻額
                  <div className="yen-input"><span>¥</span><input inputMode="numeric" value={f.payout} onChange={(e) => set('payout', e.target.value)} placeholder="0" /></div>
                </label>
                <label>
                  的中した馬券の購入額 <small>（任意・税金計算用）</small>
                  <div className="yen-input"><span>¥</span><input inputMode="numeric" value={f.hitCost} onChange={(e) => set('hitCost', e.target.value)} placeholder="0" /></div>
                </label>
                {(num(f.amount) > 0 || num(f.payout) > 0) && (
                  <p className={`keiba-net ${num(f.payout) - num(f.amount) >= 0 ? 'plus' : 'minus'}`}>
                    収支 {num(f.payout) - num(f.amount) >= 0 ? '+' : ''}{(num(f.payout) - num(f.amount)).toLocaleString()}円
                  </p>
                )}
              </>
            )}

            {f.kind === 'expense' && (
              <>
                <div className="field">
                  <span className="field-label">分類</span>
                  <div className="seg small">
                    {(Object.keys(GROUP_LABEL) as ExpenseGroup[]).map((g) => (
                      <button type="button" key={g} className={f.group === g ? 'on' : ''} onClick={() => set('group', g)}>{GROUP_LABEL[g]}</button>
                    ))}
                  </div>
                </div>
                <label>
                  カテゴリ
                  <select
                    value={f.category}
                    onChange={(e) => {
                      setCategoryTouched(true);
                      setF((p) => ({ ...p, category: e.target.value, group: defaultGroupFor(e.target.value) }));
                    }}
                  >
                    {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={f.sideExpense} onChange={(e) => set('sideExpense', e.target.checked)} />
                  副業の経費として計上する
                </label>
              </>
            )}

            {f.kind === 'income' && (
              <div className="field">
                <span className="field-label">収入の種類</span>
                <div className="seg small">
                  {(Object.keys(INCOME_LABEL) as IncomeType[]).map((t) => (
                    <button type="button" key={t} className={f.incomeType === t ? 'on' : ''} onClick={() => set('incomeType', t)}>{INCOME_LABEL[t]}</button>
                  ))}
                </div>
                {f.incomeType === 'side' && <small className="muted">副業の収入は税金の概算に使われます</small>}
              </div>
            )}

            <label>
              {f.kind === 'keiba' ? 'レース・メモ' : 'メモ・店名'}
              <input value={f.memo} onChange={(e) => onMemo(e.target.value)} placeholder={f.kind === 'keiba' ? '例: 東京11R 天皇賞' : '例: スーパー'} />
            </label>

            {error && <p className="error">{error}</p>}

            <div className="form-actions">
              {editing && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    if (confirm('この明細を削除しますか？')) {
                      deleteTransaction(editing.id);
                      onClose();
                    }
                  }}
                >
                  削除
                </button>
              )}
              <span className="grow" />
              <button type="button" className="btn" onClick={onClose}>キャンセル</button>
              <button type="submit" className="btn primary">保存</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
