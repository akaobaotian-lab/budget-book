import { useState } from 'react';
import type { Kind, Transaction } from './types';
import { currentMonth } from './lib/date';
import { EntryForm } from './components/EntryForm';
import { HomePage, KeibaPage, LendingPage, ListPage, MonthPicker, ReportPage, type Tab } from './components/pages';
import { TaxPage } from './components/TaxPage';
import { RecurringPage } from './components/RecurringPage';
import { SettingsPage } from './components/SettingsPage';

const TABS: [Tab, string, string][] = [
  ['home', '🏠', 'ホーム'],
  ['list', '📋', '明細'],
  ['report', '📊', '集計'],
  ['lending', '🤝', '貸し借り'],
  ['keiba', '🏇', '競馬'],
  ['tax', '🧾', '税金'],
  ['recurring', '🔁', '固定費'],
  ['settings', '⚙️', '設定'],
];

const MONTHLY_TABS: Tab[] = ['home', 'list', 'report', 'keiba'];

type Entry = { editing?: Transaction; kind?: Kind; mode?: 'manual' | 'voice' | 'receipt' } | null;

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [month, setMonth] = useState(currentMonth());
  const [entry, setEntry] = useState<Entry>(null);

  const props = {
    month,
    onEdit: (t: Transaction) => setEntry({ editing: t }),
    onAdd: (kind?: Kind, mode?: 'manual' | 'voice' | 'receipt') => setEntry({ kind, mode }),
    go: (t: Tab) => {
      setTab(t);
      window.scrollTo({ top: 0 });
    },
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>家計簿</h1>
        {MONTHLY_TABS.includes(tab) && <MonthPicker month={month} setMonth={setMonth} />}
      </header>

      <nav className="tabs" aria-label="メニュー">
        {TABS.map(([k, icon, label]) => (
          <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => props.go(k)} aria-current={tab === k ? 'page' : undefined}>
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'home' && <HomePage {...props} />}
        {tab === 'list' && <ListPage {...props} />}
        {tab === 'report' && <ReportPage {...props} />}
        {tab === 'lending' && <LendingPage {...props} />}
        {tab === 'keiba' && <KeibaPage {...props} />}
        {tab === 'tax' && <TaxPage month={month} />}
        {tab === 'recurring' && <RecurringPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <button type="button" className="fab" onClick={() => setEntry({})} aria-label="明細を追加">＋</button>

      {entry && (
        <EntryForm
          editing={entry.editing}
          initialKind={entry.kind}
          initialMode={entry.mode}
          onClose={() => setEntry(null)}
        />
      )}
    </div>
  );
}
