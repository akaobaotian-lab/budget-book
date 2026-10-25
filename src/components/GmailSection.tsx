import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { appUrl } from '../lib/install';
import type { ExpenseGroup } from '../types';
import { useStore } from '../store';
import { DEFAULT_GMAIL_QUERY, authorize, fetchCardUsages, getProfileEmail, signOut, type MailUsage } from '../lib/gmail';
import { fetchViaScript, gmailFromShareText, gmailShareUrl, isScriptUrl, itemsToAdd, newToken, scriptCode, usageToTransaction } from '../lib/gmailScript';
import { GROUP_LABEL } from '../lib/categories';
import { formatDate, today } from '../lib/date';
import { yen } from '../lib/format';

export function GmailSection() {
  const { data, updateSettings, addTransactions, updateTransaction } = useStore();
  const g = data.settings.gmail;
  const setG = (patch: Partial<typeof g>) => updateSettings({ gmail: { ...g, ...patch } });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<MailUsage[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<ExpenseGroup | 'auto'>('auto');

  const imported = useMemo(() => new Set(data.transactions.map((t) => t.gmailId).filter(Boolean)), [data.transactions]);

  // スクリプトに埋め込む合言葉を用意する
  useEffect(() => {
    if (!g.scriptToken) setG({ scriptToken: newToken() });
  }, [g.scriptToken]);

  const run = async (fn: () => Promise<MailUsage[]>) => {
    setError('');
    setFound(null);
    try {
      const usages = await fn();
      setFound(usages);
      setSelected(new Set(usages.filter((u) => !imported.has(u.key)).map((u) => u.key)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const readViaScript = (url = g.scriptUrl, connecting = false, token = g.scriptToken) =>
    run(async () => {
      setBusy('Gmail を読み取っています…（20秒ほどかかることがあります）');
      const { email, usages } = await fetchViaScript(url, token, g.query);
      if (connecting) setG({ scriptUrl: url.trim(), scriptToken: token, email, autoSince: today() });
      for (const { id, patch } of itemsToAdd(data.transactions, usages)) updateTransaction(id, patch);
      return usages;
    });

  const readViaOAuth = () =>
    run(async () => {
      setBusy('ログインしています…');
      await authorize(g.clientId, g.email);
      const email = await getProfileEmail();
      if (g.email && email.toLowerCase() !== g.email.toLowerCase()) {
        throw new Error(`登録した Gmail（${g.email}）とは別のアカウント（${email}）でログインしています`);
      }
      setBusy('メールを検索しています…');
      return fetchCardUsages(g.query || DEFAULT_GMAIL_QUERY, (d, t) => setBusy(`メールを読み取っています… ${d}/${t}`));
    });

  const registerOAuth = async () => {
    setError('');
    setBusy('Googleにログインしています…');
    try {
      await authorize(g.clientId.trim(), g.email, true);
      setG({ email: await getProfileEmail(), clientId: g.clientId.trim() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const doImport = () => {
    if (!found) return;
    const txs = found.filter((u) => selected.has(u.key) && !imported.has(u.key)).map((u) => usageToTransaction(u, group));
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
    <section className="card" id="gmail">
      <h3>✉️ Gmail取り込み（クレジットカード利用通知）</h3>
      <p className="muted small">
        Gmail に届くカード会社の「ご利用のお知らせ」メールから、利用日・利用先・金額を読み取って明細に追加します。Amazon・楽天市場などの注文確認メールが届いていれば、金額と日付が合うものから買った商品名も付けます。
      </p>

      <div className="seg small">
        <button type="button" className={g.method === 'script' ? 'on' : ''} onClick={() => setG({ method: 'script' })}>かんたん設定（おすすめ）</button>
        <button type="button" className={g.method === 'oauth' ? 'on' : ''} onClick={() => setG({ method: 'oauth' })}>Google Cloud で設定</button>
      </div>

      {g.method === 'script' ? (
        g.scriptUrl ? (
          <div className="form">
            <p className="hint">✅ 接続済み：<strong>{g.email || 'Gmail'}</strong></p>
            <label className="check">
              <input type="checkbox" checked={g.autoImport} onChange={(e) => setG({ autoImport: e.target.checked })} />
              アプリを開いたときに新しい利用を自動で取り込む
            </label>
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => readViaScript()}>
              今すぐ読み取る（過去の分も確認）
            </button>
            {g.lastImportedAt && <small className="muted">前回の手動取り込み：{new Date(g.lastImportedAt).toLocaleString('ja-JP')}</small>}
            <ShareToPhone link={gmailShareUrl(appUrl(), g.scriptUrl, g.scriptToken)} />
            <button type="button" className="link small danger-link" onClick={() => confirm('Gmail との接続を解除しますか？') && setG({ scriptUrl: '', email: '' })}>
              接続を解除
            </button>
          </div>
        ) : (
          <ScriptSetup
            token={g.scriptToken}
            busy={!!busy}
            onConnect={(text) => {
              // 他の端末の共有リンクを貼った場合は、その URL と合言葉で接続する
              const shared = gmailFromShareText(text);
              if (shared) readViaScript(shared.scriptUrl, true, shared.scriptToken);
              else readViaScript(text, true);
            }}
          />
        )
      ) : (
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
              <li>「クライアント」→「クライアントを作成」→ 種類「ウェブ アプリケーション」</li>
              <li>「承認済みの JavaScript 生成元」に <code>{location.origin}</code> を追加</li>
              <li>発行されたクライアントIDを上の欄に貼り付け</li>
            </ol>
          </details>
          <div className="row">
            <span className="grow">登録中の Gmail：<strong>{g.email || '未登録'}</strong></span>
            <button type="button" className="btn" disabled={!g.clientId || !!busy} onClick={registerOAuth}>
              {g.email ? '別のアカウントに変更' : 'Gmailを登録'}
            </button>
            {g.email && <button type="button" className="btn danger" onClick={() => { signOut(); setG({ email: '' }); }}>登録解除</button>}
          </div>
          <button type="button" className="btn primary" disabled={!g.clientId || !g.email || !!busy} onClick={readViaOAuth}>
            カード利用メールを読み取る
          </button>
        </div>
      )}

      <details className="small">
        <summary>検索条件（詳細設定）</summary>
        <div className="form">
          <input value={g.query} onChange={(e) => setG({ query: e.target.value })} />
          <button type="button" className="link small" onClick={() => setG({ query: DEFAULT_GMAIL_QUERY })}>既定に戻す</button>
        </div>
      </details>

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
          {found.length === 0 && (
            <p className="muted small">
              カードの利用通知メールが見つかりませんでした。カード会社の会員サイトで「カード利用通知メール」がオンになっているか確認してください。
            </p>
          )}
          <ul>
            {found.map((u) => {
              const done = imported.has(u.key);
              return (
                <li key={u.key} className={done ? 'inactive' : ''}>
                  <label className="check">
                    <input type="checkbox" disabled={done} checked={selected.has(u.key) && !done} onChange={() => toggle(u.key)} />
                    <span className="grow">
                      {u.merchant}
                      <small className="muted"> {formatDate(u.date)} ・ {u.card}{u.detail ? ` ・ ${u.detail}` : ''}{done ? ' ・ 取り込み済み' : ''}</small>
                      {u.items?.length ? <small className="tx-items"><br />🛒 {u.items.join('、')}</small> : null}
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

/** Apps Script の設定手順 */
function ScriptSetup({ token, busy, onConnect }: { token: string; busy: boolean; onConnect(url: string): void }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const code = token ? scriptCode(token) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert('コピーできませんでした。下の「スクリプトを表示」から選択してコピーしてください');
    }
  };

  return (
    <div className="form">
      <p className="muted small">
        Google のクラウド設定は不要です。自分の Google アカウントで小さなスクリプトを動かして、カードの利用通知メールだけを家計簿に渡します（パソコンで約5分・最初の1回だけ）。
      </p>
      <ol className="steps">
        <li>
          <button type="button" className="btn primary" onClick={copy} disabled={!code}>
            {copied ? '✅ コピーしました' : '📋 スクリプトをコピー'}
          </button>
          <details className="small">
            <summary>スクリプトを表示</summary>
            <pre className="code">{code}</pre>
          </details>
        </li>
        <li>
          カード通知が届く Gmail のアカウントで{' '}
          <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">Apps Script を開く</a>
          。最初から入っている文字をすべて消して、コピーしたスクリプトを貼り付け、💾（保存）を押す
        </li>
        <li>右上の「<strong>デプロイ</strong>」→「<strong>新しいデプロイ</strong>」→ 左の ⚙️ で「<strong>ウェブアプリ</strong>」を選ぶ</li>
        <li>
          「次のユーザーとして実行」は<strong>自分</strong>、「アクセスできるユーザー」は<strong>全員</strong>にして「デプロイ」
          <br />
          <small className="muted">※ 合言葉を知らない人はデータを読めないようになっています</small>
        </li>
        <li>
          「アクセスを承認」→ アカウントを選ぶ →「Google はこのアプリを確認していません」と出たら
          「<strong>詳細</strong>」→「<strong>（安全ではないページ）に移動</strong>」→「<strong>許可</strong>」
          <br />
          <small className="muted">※ 自分で作った自分専用のスクリプトなので問題ありません</small>
        </li>
        <li>表示された「<strong>ウェブアプリ</strong>」の URL をコピーして、下に貼り付けて「接続」</li>
      </ol>
      <label>
        ウェブアプリの URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" inputMode="url" />
      </label>
      {url.trim() && !isScriptUrl(url) && !gmailFromShareText(url) && (
        <p className="error small">「https://script.google.com/macros/s/…/exec」の形の URL を貼り付けてください（「ライブラリ」の URL ではありません）</p>
      )}
      <p className="muted small">※ パソコンで設定済みなら、パソコンの「スマホでも自動取り込み」のリンクをここに貼り付けても接続できます</p>
      <button type="button" className="btn primary" disabled={busy || !(isScriptUrl(url) || gmailFromShareText(url))} onClick={() => onConnect(url)}>
        接続
      </button>
    </div>
  );
}

/** 他の端末（スマホ）に設定を渡す QR コードとリンク */
function ShareToPhone({ link }: { link: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (open) QRCode.toDataURL(link, { margin: 1, width: 360 }).then(setQr, () => setQr(''));
  }, [open, link]);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(!open)}>📱 スマホでも自動取り込み</button>
      {open && (
        <div className="qr">
          {qr && <img src={qr} alt="スマホ用のQRコード" width={180} height={180} />}
          <div>
            <strong>スマホのカメラで読み取る</strong>
            <p className="small muted">
              Chrome で開くと、スマホの家計簿でも自動で取り込むようになります（スクリプトの設定はパソコンの1回だけで大丈夫です）。
              自動同期を設定している場合は不要です。
            </p>
            <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(link)}>リンクをコピー</button>
          </div>
        </div>
      )}
    </>
  );
}
