/** 同期先（Firebase プロジェクト）の接続情報。端末ごとに保存する */
export interface SyncConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
    storageBucket?: string;
    messagingSenderId?: string;
  };
  /** テスト用：Firebase Emulator のホスト */
  emulatorHost?: string;
  /** この端末を一度でも同期に接続したユーザーID（初回だけ端末のデータをクラウドに合わせる） */
  linkedUid?: string;
}

const KEY = 'budget-book-sync';

/** 同期を解除した端末の目印（アプリに組み込まれた接続情報を使わない） */
const OFF = 'off';

/**
 * アプリに組み込む接続情報。公開時（GitHub Actions）にリポジトリ変数 FIREBASE_CONFIG から設定される。
 * 組み込まれていれば、どの端末もログインするだけで同期できる。
 */
export function builtInConfig(): SyncConfig | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
  const firebase = raw ? parseFirebaseConfig(raw) : null;
  return firebase ? { firebase } : null;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === OFF) return null;
    return raw ? (JSON.parse(raw) as SyncConfig) : builtInConfig();
  } catch {
    return null;
  }
}

export function saveSyncConfig(c: SyncConfig | null) {
  try {
    localStorage.setItem(KEY, c ? JSON.stringify(c) : OFF);
  } catch {
    // 保存できない環境では何もしない
  }
}

/**
 * Firebase コンソールに表示される設定（JSON でも `const firebaseConfig = {...}` の形でも可）を読み取る
 */
export function parseFirebaseConfig(text: string): SyncConfig['firebase'] | null {
  const pick = (k: string) => text.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`))?.[1];
  const apiKey = pick('apiKey');
  const authDomain = pick('authDomain');
  const projectId = pick('projectId');
  const appId = pick('appId');
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain: authDomain ?? `${projectId}.firebaseapp.com`,
    projectId,
    appId,
    storageBucket: pick('storageBucket'),
    messagingSenderId: pick('messagingSenderId'),
  };
}

const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** 他の端末を接続するためのURL（#以降はサーバーに送信されない） */
export function shareUrl(base: string, c: SyncConfig): string {
  const payload: Pick<SyncConfig, 'firebase' | 'emulatorHost'> = { firebase: c.firebase, emulatorHost: c.emulatorHost };
  return `${base}#sync=${toB64(JSON.stringify(payload))}`;
}

/** 「他の端末を接続」のリンク（またはその一部）から接続情報を取り出す */
export function configFromShareText(text: string): SyncConfig | null {
  const m = text.match(/sync=([\w-]+)/);
  if (!m) return null;
  try {
    const c = JSON.parse(fromB64(m[1])) as SyncConfig;
    return c.firebase?.apiKey && c.firebase.projectId ? { firebase: c.firebase, emulatorHost: c.emulatorHost } : null;
  } catch {
    return null;
  }
}

/** 貼り付けられた内容（共有リンク・firebaseConfig）から接続情報を読み取る */
export function configFromText(text: string): SyncConfig | null {
  const shared = configFromShareText(text);
  if (shared) return shared;
  const firebase = parseFirebaseConfig(text);
  return firebase ? { firebase } : null;
}

/** URL に接続情報が含まれていれば取り出し、URL から消す */
export function takeConfigFromUrl(): SyncConfig | null {
  if (!location.hash.includes('sync=')) return null;
  const c = configFromShareText(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  return c;
}
