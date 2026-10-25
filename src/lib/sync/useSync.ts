import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppData } from '../../types';
import { SyncEngine, type RemoteSnapshot } from './engine';
import { loadSyncConfig, saveSyncConfig, shareUrl, takeConfigFromUrl, type SyncConfig } from './config';
import type { FirebaseRemote } from './firebase';

export type SyncPhase = 'off' | 'loading' | 'signedOut' | 'connecting' | 'synced' | 'error';

export interface SyncState {
  phase: SyncPhase;
  config: SyncConfig | null;
  email: string | null;
  /** クラウドと接続できているか */
  online: boolean;
  /** 未送信の変更があるか */
  pending: boolean;
  lastSyncedAt: number | null;
  error: string;
}

export interface SyncApi {
  state: SyncState;
  configure(c: SyncConfig | null): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  shareUrl(base: string): string | null;
}

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが違います',
  'auth/wrong-password': 'パスワードが違います',
  'auth/user-not-found': 'このメールアドレスは登録されていません',
  'auth/email-already-in-use': 'このメールアドレスは登録済みです。ログインしてください',
  'auth/weak-password': 'パスワードは6文字以上にしてください',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません',
  'auth/popup-closed-by-user': 'ログインがキャンセルされました',
  'auth/popup-blocked': 'ポップアップがブロックされました。メールアドレスでログインしてください',
  'auth/unauthorized-domain': 'このURLが Firebase の「承認済みドメイン」に登録されていません',
  'auth/operation-not-allowed': 'Firebase でこのログイン方法が有効になっていません',
  'auth/network-request-failed': 'ネットワークに接続できません',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてからお試しください',
  'auth/invalid-api-key': '接続情報（apiKey）が正しくありません',
  'permission-denied': 'クラウドへのアクセスが拒否されました。Firestore のルールを確認してください',
};

export function syncErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  return ERRORS[code] ?? ERRORS[code.replace(/^firestore\//, '')] ?? (e instanceof Error ? e.message : String(e));
}

const initialConfig = (): SyncConfig | null => {
  const fromUrl = takeConfigFromUrl();
  if (fromUrl) {
    const current = loadSyncConfig();
    // 同じ同期先なら、この端末の接続済み情報を保持する
    const merged = current?.firebase.projectId === fromUrl.firebase.projectId ? { ...current, ...fromUrl } : fromUrl;
    saveSyncConfig(merged);
    return merged;
  }
  return loadSyncConfig();
};

/**
 * 端末のデータをクラウドと自動同期する。
 * @param transform クラウドから受け取ったデータに適用する処理（固定費の自動記入など）
 */
export function useSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>, transform: (d: AppData) => AppData): SyncApi {
  const [config, setConfig] = useState<SyncConfig | null>(initialConfig);
  const [state, setState] = useState<SyncState>(() => ({
    phase: config ? 'loading' : 'off', config, email: null, online: false, pending: false, lastSyncedAt: null, error: '',
  }));
  const remoteRef = useRef<FirebaseRemote | null>(null);
  const uidRef = useRef<string | null>(null);
  const engineRef = useRef(new SyncEngine());
  const patch = (p: Partial<SyncState>) => setState((s) => ({ ...s, ...p }));

  // 接続・ログイン状態の監視
  useEffect(() => {
    if (!config) {
      setState((s) => ({ ...s, phase: 'off', config: null, email: null, online: false, pending: false, error: '' }));
      return;
    }
    let cancelled = false;
    let unsubData: (() => void) | null = null;
    let unsubUser: (() => void) | null = null;
    let remote: FirebaseRemote | null = null;
    patch({ phase: 'loading', config, error: '' });

    import('./firebase')
      .then(({ FirebaseRemote }) => {
        if (cancelled) return;
        remote = new FirebaseRemote(config);
        remoteRef.current = remote;
        unsubUser = remote.onUser((user) => {
          unsubData?.();
          unsubData = null;
          engineRef.current.reset();
          uidRef.current = user?.uid ?? null;
          if (!user) {
            patch({ phase: 'signedOut', email: null, online: false, pending: false });
            return;
          }
          patch({ phase: 'connecting', email: user.email, error: '' });
          const firstLink = loadSyncConfig()?.linkedUid !== user.uid;
          // React の開発モードでは更新関数が2回呼ばれるため、同じ入力には同じ結果を返す
          let memo: { snap: RemoteSnapshot; input: AppData; output: AppData } | null = null;

          unsubData = remote!.subscribe(
            user.uid,
            (snap) => {
              setData((d) => {
                if (memo && memo.snap === snap && memo.input === d) return memo.output;
                const output = transform(engineRef.current.applyRemote(snap, d, firstLink));
                memo = { snap, input: d, output };
                return output;
              });
              if (firstLink) {
                const c = loadSyncConfig();
                if (c && c.linkedUid !== user.uid) saveSyncConfig({ ...c, linkedUid: user.uid });
              }
              setState((s) => (s.phase === 'connecting' ? { ...s, phase: 'synced' } : s));
            },
            ({ online, pending }) =>
              setState((s) => ({ ...s, online, pending, lastSyncedAt: online && !pending ? Date.now() : s.lastSyncedAt })),
            (e) => patch({ phase: 'error', error: syncErrorMessage(e) }),
          );
        });
      })
      .catch((e) => patch({ phase: 'error', error: syncErrorMessage(e) }));

    return () => {
      cancelled = true;
      unsubData?.();
      unsubUser?.();
      engineRef.current.reset();
      uidRef.current = null;
      remoteRef.current = null;
      remote?.close();
    };
    // transform と setData は呼び出し側で固定なので、接続情報が変わったときだけ繋ぎ直す
  }, [config]);

  // 端末側の変更をクラウドへ送信
  useEffect(() => {
    const remote = remoteRef.current;
    const uid = uidRef.current;
    if (!remote || !uid || !engineRef.current.isReady) return;
    const ops = engineRef.current.diff(data);
    if (ops.length === 0) return;
    // オフライン時は端末に保存され、接続時に自動で送信される（完了を待たない）
    remote.write(uid, ops).catch((e) => patch({ phase: 'error', error: syncErrorMessage(e) }));
  }, [data, state.phase]);

  const run = useCallback(async (fn: (r: FirebaseRemote) => Promise<unknown>) => {
    const r = remoteRef.current;
    if (!r) throw new Error('同期の準備中です。少し待ってからお試しください');
    try {
      await fn(r);
      patch({ error: '' });
    } catch (e) {
      throw new Error(syncErrorMessage(e));
    }
  }, []);

  return {
    state,
    configure: async (c) => {
      if (!c) await remoteRef.current?.signOut().catch(() => undefined);
      saveSyncConfig(c);
      setConfig(c);
    },
    signIn: (email, password) => run((r) => r.signIn(email, password)),
    signUp: (email, password) => run((r) => r.signUp(email, password)),
    signInWithGoogle: () => run((r) => r.signInWithGoogle()),
    resetPassword: (email) => run((r) => r.resetPassword(email)),
    signOut: () => run((r) => r.signOut()),
    shareUrl: (base) => (config ? shareUrl(base, config) : null),
  };
}
