import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../store';
import { configFromText } from '../lib/sync/config';
import { appUrl } from '../lib/install';
import type { SyncState } from '../lib/sync/useSync';

export function syncBadge(s: SyncState): { icon: string; label: string; tone: 'ok' | 'warn' | 'muted' | 'error' } | null {
  switch (s.phase) {
    case 'off':
      return null;
    case 'loading':
    case 'connecting':
      return { icon: '🔄', label: '接続中', tone: 'muted' };
    case 'signedOut':
      return { icon: '🔒', label: '未ログイン', tone: 'warn' };
    case 'error':
      return { icon: '⚠️', label: '同期エラー', tone: 'error' };
    case 'synced':
      if (!s.online) return { icon: '📴', label: s.pending ? 'オフライン（未送信あり）' : 'オフライン', tone: 'warn' };
      if (s.pending) return { icon: '⏫', label: '送信中', tone: 'muted' };
      return { icon: '☁️', label: '同期済み', tone: 'ok' };
  }
}

/** ヘッダーの同期状態表示 */
export function SyncBadge({ onClick }: { onClick(): void }) {
  const { sync } = useStore();
  const b = syncBadge(sync.state);
  if (!b) return null;
  return (
    <button type="button" className={`sync-badge ${b.tone}`} onClick={onClick} title="同期の設定">
      <span aria-hidden>{b.icon}</span> {b.label}
    </button>
  );
}

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

export function SyncSection() {
  const { sync } = useStore();
  const s = sync.state;

  return (
    <section className="card" id="sync">
      <h3>🔄 パソコンとスマホの自動同期</h3>
      {s.phase === 'off' ? <SetupForm /> : s.phase === 'signedOut' || (s.phase === 'error' && !s.email) ? <LoginForm /> : <Connected />}
      {s.error && <p className="error">{s.error}</p>}
      {s.phase !== 'off' && (
        <button
          type="button"
          className="link small danger-link"
          onClick={() => confirm('この端末の同期を解除しますか？（この端末とクラウドのデータはどちらも残ります）') && sync.configure(null)}
        >
          この端末の同期を解除
        </button>
      )}
    </section>
  );
}

function SetupForm() {
  const { sync } = useStore();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="form">
      <p className="muted small">
        無料の Firebase（Google のクラウドデータベース）を使って、ログインした端末どうしでデータを自動で同期します。
        どの端末で入力・編集・削除してもすぐ他の端末に反映され、オフライン中の変更も接続時に送信されます。
      </p>
      <p className="hint">
        <strong>2台目以降の端末</strong>：1台目の端末の「他の端末を接続」に表示される QR コードを読み取るか、そのリンクを下の欄に貼り付けてください。
        iPhone でホーム画面に追加したアプリは Safari とデータが別になるため、アプリを開いてからリンクを貼り付けてください。
      </p>
      <details className="small">
        <summary>1台目の準備（Firebase の設定・約5分）</summary>
        <ol>
          <li><a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">Firebase コンソール</a>で「プロジェクトを作成」（Google アナリティクスは不要）</li>
          <li>「構築 → Authentication → 始める」で「メール/パスワード」を有効にする（Google ログインも使う場合は「Google」も有効に）</li>
          <li>（Google ログインを使う場合）Authentication の「設定 → 承認済みドメイン」に <code>{location.hostname}</code> を追加</li>
          <li>「構築 → Firestore Database → データベースを作成」（本番環境モード・ロケーションは asia-northeast1 など）</li>
          <li>Firestore の「ルール」タブに次の内容を貼り付けて「公開」
            <pre className="code">{RULES}</pre>
          </li>
          <li>プロジェクトの設定（⚙️）→「マイアプリ」でウェブアプリ（&lt;/&gt;）を追加し、表示された <code>firebaseConfig</code> をコピー</li>
          <li>コピーした内容を下の欄に貼り付けて「接続」</li>
        </ol>
      </details>
      <label>
        共有リンク または Firebase の設定（firebaseConfig）
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  projectId: "...",\n  appId: "..."\n};'}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          const c = configFromText(text);
          if (!c) return setError('接続情報が見つかりません。共有リンク、または firebaseConfig の内容をそのまま貼り付けてください');
          sync.configure(c);
        }}
      >
        接続
      </button>
    </div>
  );
}

function LoginForm() {
  const { sync } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const act = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => sync.signIn(email.trim(), password));
      }}
    >
      <p className="muted small">すべての端末で<strong>同じアカウント</strong>でログインしてください。初めての場合は「新規登録」を押します。</p>
      <label>
        メールアドレス
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        パスワード（6文字以上）
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </label>
      {error && <p className="error">{error}</p>}
      {msg && <p className="hint">{msg}</p>}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy}>ログイン</button>
        <button type="button" className="btn" disabled={busy || !email || password.length < 6} onClick={() => act(() => sync.signUp(email.trim(), password))}>
          新規登録
        </button>
        <span className="grow" />
        <button type="button" className="link small" disabled={busy || !email} onClick={() => act(() => sync.resetPassword(email.trim()), 'パスワード再設定のメールを送信しました')}>
          パスワードを忘れた
        </button>
      </div>
      <button type="button" className="btn" disabled={busy} onClick={() => act(() => sync.signInWithGoogle())}>
        Google アカウントでログイン
      </button>
    </form>
  );
}

function Connected() {
  const { sync, data } = useStore();
  const s = sync.state;
  const b = syncBadge(s);
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const link = sync.shareUrl(appUrl());

  useEffect(() => {
    if (showQr && link) QRCode.toDataURL(link, { margin: 1, width: 360 }).then(setQr, () => setQr(''));
  }, [showQr, link]);

  return (
    <div className="form">
      <div className="row">
        <span className="grow">
          {b && <span className={`sync-badge ${b.tone}`}>{b.icon} {b.label}</span>}
          <br />
          <small className="muted">
            {s.email ?? 'ログイン中'}
            {s.lastSyncedAt && ` ・ 最終同期 ${new Date(s.lastSyncedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`}
            {` ・ 明細 ${data.transactions.length}件`}
          </small>
        </span>
        <button type="button" className="btn small" onClick={() => sync.signOut().catch(() => undefined)}>ログアウト</button>
      </div>

      <button type="button" className="btn" onClick={() => setShowQr(!showQr)}>📱 他の端末を接続</button>
      {showQr && link && (
        <div className="qr">
          {qr && <img src={qr} alt="同期用のQRコード" width={180} height={180} />}
          <div>
            <strong>スマホのカメラで読み取る</strong>
            <p className="small muted">
              開いたページで同じアカウントでログインすると同期が始まります。
              iPhone でホーム画面に追加したアプリで使う場合は、「リンクをコピー」してLINEやメールでスマホに送り、アプリの「設定 → 自動同期」の欄に貼り付けてください。
            </p>
            <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(link)}>リンクをコピー</button>
          </div>
        </div>
      )}
      <p className="muted small">
        同じ明細を複数の端末で同時に編集した場合は、後から保存した内容が残ります。Gmail取り込みや税金の設定も同期されます。
      </p>
    </div>
  );
}
