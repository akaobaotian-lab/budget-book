import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Recurring, Settings, Transaction } from '../../types';
import { SETTINGS_ID, type Op, type RemoteSnapshot } from './engine';
import type { SyncConfig } from './config';

export interface SyncStatus {
  /** クラウドから最新を受け取れているか（false = オフラインでキャッシュ表示中） */
  online: boolean;
  /** 未送信の変更があるか */
  pending: boolean;
}

/** Firebase（認証 + Firestore）への接続 */
export class FirebaseRemote {
  private app: FirebaseApp;
  readonly auth: Auth;
  private db: Firestore;

  constructor(config: SyncConfig) {
    // 同じ名前のアプリが残っていると初期化できないため、設定ごとに名前を分ける
    this.app = initializeApp(config.firebase, `budget-${config.firebase.projectId}`);
    this.auth = initializeAuth(this.app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    // オフラインでも使えるよう端末内にキャッシュし、未送信の変更は再接続時に自動で送信される
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
    if (config.emulatorHost) {
      connectAuthEmulator(this.auth, `http://${config.emulatorHost}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(this.db, config.emulatorHost, 8080);
    }
  }

  onUser(cb: (u: User | null) => void) {
    return onAuthStateChanged(this.auth, cb);
  }

  signIn(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  signUp(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  signInWithGoogle() {
    return signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  signOut() {
    return signOut(this.auth);
  }

  /** ユーザーのデータを購読する。3つのコレクションが揃うたびに全体を通知 */
  subscribe(
    uid: string,
    onData: (s: RemoteSnapshot) => void,
    onStatus: (s: SyncStatus) => void,
    onError: (e: Error) => void,
  ): () => void {
    const base = `users/${uid}`;
    const state: { tx?: Transaction[]; rec?: Recurring[]; settings?: Settings | null } = {};
    const meta = { tx: { cache: true, pending: false }, rec: { cache: true, pending: false }, set: { cache: true, pending: false } };

    const emit = () => {
      onStatus({
        online: !meta.tx.cache && !meta.rec.cache && !meta.set.cache,
        pending: meta.tx.pending || meta.rec.pending || meta.set.pending,
      });
      if (state.tx && state.rec && state.settings !== undefined) {
        onData({ transactions: state.tx, recurring: state.rec, settings: state.settings });
      }
    };

    const opts = { includeMetadataChanges: true };
    const unsubs = [
      onSnapshot(collection(this.db, `${base}/transactions`), opts, (s) => {
        meta.tx = { cache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites };
        state.tx = s.docs.map((d) => ({ ...(d.data() as Transaction), id: d.id }));
        emit();
      }, onError),
      onSnapshot(collection(this.db, `${base}/recurring`), opts, (s) => {
        meta.rec = { cache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites };
        state.rec = s.docs.map((d) => ({ ...(d.data() as Recurring), id: d.id }));
        emit();
      }, onError),
      onSnapshot(doc(this.db, `${base}/meta/${SETTINGS_ID}`), opts, (s) => {
        meta.set = { cache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites };
        state.settings = s.exists() ? (s.data() as Settings) : null;
        emit();
      }, onError),
    ];
    return () => unsubs.forEach((u) => u());
  }

  /** 変更をまとめて書き込む（オフライン時は端末に保存され、接続時に送信される） */
  async write(uid: string, ops: Op[]): Promise<void> {
    // 1回の書き込みは500件まで
    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(this.db);
      for (const op of ops.slice(i, i + 450)) {
        const ref = doc(this.db, `users/${uid}/${op.col}/${op.id}`);
        if (op.type === 'set') batch.set(ref, op.data);
        else batch.delete(ref);
      }
      await batch.commit();
    }
  }

  async close() {
    await terminate(this.db).catch(() => undefined);
    await deleteApp(this.app).catch(() => undefined);
  }
}
