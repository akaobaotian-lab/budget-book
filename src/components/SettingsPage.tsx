import type { AppData } from '../types';
import { useStore } from '../store';
import { today } from '../lib/date';
import { GmailSection } from './GmailSection';
import { InstallSection } from './InstallSection';
import { SyncSection } from './SyncSection';

export function SettingsPage() {
  return (
    <div className="page">
      <SyncSection />
      <InstallSection />
      <GmailSection />
      <BackupSection />
    </div>
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
