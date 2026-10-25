import { useMemo, useState } from 'react';
import type { AppData, ExpenseGroup } from '../types';
import { useStore, type NewTransaction } from '../store';
import { DEFAULT_GMAIL_QUERY, authorize, fetchCardUsages, getProfileEmail, signOut, type MailUsage } from '../lib/gmail';
import { GROUP_LABEL, defaultGroupFor, guessCategory } from '../lib/categories';
import { formatDate, today } from '../lib/date';
import { yen } from '../lib/format';
import { InstallSection } from './InstallSection';

export function SettingsPage() {
  return (
    <div className="page">
      <InstallSection />
      <GmailSection />
      <BackupSection />
    </div>
  );
}

function GmailSection() {
  const { data, updateSettings, addTransactions } = useStore();
  const g = data.settings.gmail;
  const setG = (patch: Partial<typeof g>) => updateSettings({ gmail: { ...g, ...patch } });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<MailUsage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<ExpenseGroup | 'auto'>('auto');

  const imported = useMemo(() => new Set(data.transactions.map((t) => t.gmailId).filter(Boolean)), [data.transactions]);

  const register = async () => {
    setError('');
    setBusy('Googleにログインしています…');
    try {
      await authorize(g.clientId.trim(), g.email, true);
      const email = await getProfileEmail();
      setG({ email, clientId: g.clientId.trim() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const fetchMails = async () => {
    setError('');
    setFound(null);
    setBusy('ログインしています…');
    try {
      await authorize(g.clientId, g.email);
      const email = await getProfileEmail();
      if (g.email && email.toLowerCase() !== g.email.toLowerCase()) {
        throw new Error(`登録した Gmail（${g.email}）とは別のアカウント（${email}）でログインしています`);
      }
      setBusy('メールを検索しています…');
      const usages = await fetchCardUsages(g.query || DEFAULT_GMAIL_QUERY, (d, t) => setBusy(`メールを読み取っています… ${d}/${t}`));
      setFound(usages);
      setSelected(new Set(usages.filter((u) => !imported.has(u.key)).map((u) => u.key)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const doImport = () => {
    if (!found) return;
    const txs: NewTransaction[] = found
      .filter((u) => selected.has(u.key) && !imported.has(u.key))
      .map((u) => {
        const category = guessCategory(u.merchant);
        return {
          kind: 'expense',
          date: u.date,
          amount: u.amount,
          memo: u.merchant,
          category,
          group: group === 'auto' ? defaultGroupFor(category) : group,
          source: 'gmail',
          gmailId: u.key,
        };
      });
    addTransactions(txs);
    setG({ lastImportedAt: Date.now() });
    setFound(null);
    alert(`${txs.length}件を取り込みました`);
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <section className="card">
      <h3>✉️ Gmail取り込み（クレジットカード利用通知）</h3>
      <p className="muted small">
        登録した Gmail に届くカード会社の「ご利用のお知らせ」メールから、利用日・利用先・金額を読み取って明細に追加します。
        読み取りはこの端末のブラウザ内で行い、メールの内容が外部サーバーに保存されることはありません（Gmail は読み取り専用で接続します）。
      </p>

      <div className="form">
        <label>
          Google OAuth クライアントID
          <input value={g.clientId} onChange={(e) => setG({ clientId: e.target.value })} placeholder="xxxxxxxx.apps.googleusercontent.com" />
        </label>
        <details className="small">
          <summary>クライアントIDの取得方法</summary>
          <ol>
            <li>Google Cloud Console でプロジェクトを作成し、「Gmail API」を有効にする</li>
            <li>「OAuth 同意画面」を作成し、テストユーザーに自分の Gmail を追加</li>
            <li>「認証情報」→「OAuth クライアント ID」→ 種類「ウェブ アプリケーション」</li>
            <li>「承認済みの JavaScript 生成元」にこのアプリのURL（<code>{location.origin}</code>）を追加</li>
            <li>発行されたクライアントIDを上の欄に貼り付け</li>
          </ol>
        </details>

        <div className="row">
          <span className="grow">
            登録中の Gmail：<strong>{g.email || '未登録'}</strong>
          </span>
          <button type="button" className="btn" disabled={!g.clientId || !!busy} onClick={register}>
            {g.email ? '別のアカウントに変更' : 'Gmailを登録'}
          </button>
          {g.email && (
            <button type="button" className="btn danger" onClick={() => { signOut(); setG({ email: '' }); }}>登録解除</button>
          )}
        </div>

        <label>
          検索条件（Gmail の検索演算子）
          <input value={g.query} onChange={(e) => setG({ query: e.target.value })} />
        </label>
        <button type="button" className="link small" onClick={() => setG({ query: DEFAULT_GMAIL_QUERY })}>既定に戻す</button>

        <button type="button" className="btn primary" disabled={!g.clientId || !g.email || !!busy} onClick={fetchMails}>
          カード利用メールを読み取る
        </button>
        {g.lastImportedAt && <small className="muted">前回の取り込み：{new Date(g.lastImportedAt).toLocaleString('ja-JP')}</small>}
      </div>

      {busy && <p className="hint">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {found && (
        <div className="import-list">
          <div className="card-head">
            <strong>{found.length}件の利用が見つかりました</strong>
            <div className="row">
              <span className="small">分類</span>
              <select value={group} onChange={(e) => setGroup(e.target.value as ExpenseGroup | 'auto')}>
                <option value="auto">カテゴリから自動</option>
                {(Object.keys(GROUP_LABEL) as ExpenseGroup[]).map((k) => <option key={k} value={k}>{GROUP_LABEL[k]}</option>)}
              </select>
            </div>
          </div>
          <ul>
            {found.map((u) => {
              const done = imported.has(u.key);
              return (
                <li key={u.key} className={done ? 'inactive' : ''}>
                  <label className="check">
                    <input type="checkbox" disabled={done} checked={selected.has(u.key) && !done} onChange={() => toggle(u.key)} />
                    <span className="grow">
                      {u.merchant}
                      <small className="muted"> {formatDate(u.date)} ・ {u.card}{done ? ' ・ 取り込み済み' : ''}</small>
                    </span>
                    <span className="num">{yen(u.amount)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="form-actions">
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setFound(null)}>閉じる</button>
            <button type="button" className="btn primary" disabled={![...selected].some((k) => !imported.has(k))} onClick={doImport}>
              選択した{[...selected].filter((k) => !imported.has(k)).length}件を取り込む
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function BackupSection() {
  const { data, replaceAll } = useStore();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    download(blob, `家計簿_${today()}.json`);
  };

  const exportCsv = () => {
    const header = ['日付', '種類', '分類', 'カテゴリ', '金額', '払戻', '相手', 'メモ', '入力方法'];
    const rows = [...data.transactions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [t.date, t.kind, t.group ?? t.incomeType ?? '', t.category ?? '', t.amount, t.payout ?? '', t.person ?? '', t.memo, t.source]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv' }), `家計簿_${today()}.csv`);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (!Array.isArray(parsed.transactions)) throw new Error('形式が正しくありません');
      if (confirm(`${parsed.transactions.length}件の明細で現在のデータを置き換えます。よろしいですか？`)) replaceAll(parsed);
    } catch (e) {
      alert(`読み込めませんでした: ${(e as Error).message}`);
    }
  };

  return (
    <section className="card">
      <h3>💾 データのバックアップ</h3>
      <p className="muted small">データはこの端末のブラウザに保存されています。機種変更やブラウザのデータ削除に備えて、定期的にバックアップしてください。</p>
      <div className="quick">
        <button type="button" className="btn" onClick={exportJson}>バックアップを保存</button>
        <label className="btn">
          バックアップから復元
          <input type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        </label>
        <button type="button" className="btn" onClick={exportCsv}>CSVで書き出し</button>
      </div>
      <p className="muted small">明細 {data.transactions.length}件 ・ 固定費 {data.recurring.length}件</p>
    </section>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
