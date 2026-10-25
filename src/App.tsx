import { useEffect, useState } from 'react';
import type { Kind, Transaction } from './types';
import { currentMonth } from './lib/date';
import { EntryForm } from './components/EntryForm';
import { HomePage, KeibaPage, LendingPage, ListPage, MonthPicker, ReportPage, type Tab } from './components/pages';
import { TaxPage } from './components/TaxPage';
import { RecurringPage } from './components/RecurringPage';
import { SettingsPage } from './components/SettingsPage';
import { InstallButton } from './components/InstallSection';
import { SyncBadge } from './components/SyncSection';

// 他の端末の「接続」QRコードから開かれた場合は、ログインのため設定画面を表示する
const openedForSync = location.hash.includes('sync=');

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

type Mode = 'manual' | 'voice' | 'receipt';
type Entry = { editing?: Transaction; kind?: Kind; mode?: Mode; sharedImage?: File; sharedText?: string } | null;

/** 戻るボタン用に履歴へ保存する画面の状態 */
interface NavState {
  tab: Tab;
  modal?: boolean;
  /** アプリが積んだ履歴か（戻っても前の画面がアプリ内にある） */
  pushed?: boolean;
}
const navState = (): NavState | null => history.state as NavState | null;

/** アプリアイコンのショートカット（?add=voice など）から起動された場合 */
function initialEntry(): Entry {
  const add = new URLSearchParams(location.search).get('add');
  if (add !== 'manual' && add !== 'voice' && add !== 'receipt') return null;
  history.replaceState(null, '', location.pathname);
  return { mode: add };
}

/** Android の共有メニューから送られた写真・テキストを受け取る（サービスワーカーが一時保存） */
async function takeShared(): Promise<Entry> {
  if (!new URLSearchParams(location.search).has('share')) return null;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('share-inbox');
    const [img, txt] = await Promise.all([cache.match('image'), cache.match('text')]);
    await Promise.all([cache.delete('image'), cache.delete('text')]);
    const sharedImage = img ? new File([await img.blob()], 'shared.jpg', { type: img.headers.get('content-type') ?? 'image/jpeg' }) : undefined;
    const sharedText = txt ? await txt.text() : undefined;
    return sharedImage || sharedText ? { mode: sharedImage ? 'receipt' : 'manual', sharedImage, sharedText } : null;
  } catch {
    return null;
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>(openedForSync ? 'settings' : 'home');
  const [month, setMonth] = useState(currentMonth());
  const [entry, setEntry] = useState<Entry>(initialEntry);

  useEffect(() => {
    history.replaceState({ tab } satisfies NavState, '');
    takeShared().then((e) => e && setEntry(e));

    // Android の戻るボタン：入力画面を閉じる → ホームに戻る → アプリを閉じる
    const onPop = (e: PopStateEvent) => {
      const s = e.state as NavState | null;
      setTab(s?.tab ?? 'home');
      if (!s?.modal) setEntry(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 入力画面を開いたら履歴に積み、戻るボタンで閉じられるようにする
  useEffect(() => {
    if (entry && !navState()?.modal) history.pushState({ tab: navState()?.tab ?? tab, modal: true } satisfies NavState, '');
  }, [entry]);

  const closeEntry = () => {
    if (navState()?.modal) history.back();
    else setEntry(null);
  };

  const go = (t: Tab) => {
    const current = navState()?.tab ?? tab;
    if (t !== current) {
      // 履歴は「ホーム → 開いている画面」の2段にする
      const pushed = navState()?.pushed;
      if (t === 'home' && pushed) history.back();
      else if (current === 'home') history.pushState({ tab: t, pushed: true } satisfies NavState, '');
      else history.replaceState({ tab: t, pushed } satisfies NavState, '');
    }
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const props = {
    month,
    onEdit: (t: Transaction) => setEntry({ editing: t }),
    onAdd: (kind?: Kind, mode?: Mode) => setEntry({ kind, mode }),
    go,
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>家計簿</h1>
        <SyncBadge onClick={() => go('settings')} />
        <InstallButton onHelp={() => go('settings')} />
        {MONTHLY_TABS.includes(tab) && <MonthPicker month={month} setMonth={setMonth} />}
      </header>

      <nav className="tabs" aria-label="メニュー">
        {TABS.map(([k, icon, label]) => (
          <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)} aria-current={tab === k ? 'page' : undefined}>
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
          // 共有で別の内容が届いたときは入力画面を作り直す
          key={entry.sharedText ?? entry.sharedImage?.size ?? 'entry'}
          editing={entry.editing}
          initialKind={entry.kind}
          initialMode={entry.mode}
          sharedImage={entry.sharedImage}
          sharedText={entry.sharedText}
          onClose={closeEntry}
        />
      )}
    </div>
  );
}
