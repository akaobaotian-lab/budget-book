import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { appUrl, detectPlatform, useInstall, type Platform } from '../lib/install';

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: 'Windows パソコン',
  mac: 'Mac',
  ios: 'iPhone / iPad',
  android: 'Android スマホ',
  other: 'パソコン',
};

function Steps({ platform }: { platform: Platform }) {
  switch (platform) {
    case 'windows':
      return (
        <ol>
          <li>Chrome または Edge でこのページを開き、上の「インストール」ボタンを押す（アドレスバー右端の 🖥️⤓ アイコンでも可）</li>
          <li>家計簿が専用ウィンドウで開き、スタートメニューとタスクバーに追加されます</li>
          <li>
            <strong>デスクトップにショートカットを作る</strong>
            <br />Edge：インストール時に表示される「デスクトップ ショートカットを作成する」にチェック
            <br />Chrome：通常は自動で作成されます。無い場合はアドレスバーに <code>chrome://apps</code> と入力 → 家計簿を右クリック →「ショートカットを作成」→「デスクトップ」にチェック
          </li>
        </ol>
      );
    case 'mac':
      return (
        <ol>
          <li>Chrome または Edge でこのページを開き、上の「インストール」ボタンを押す（Safari の場合はメニュー「ファイル」→「Dockに追加」）</li>
          <li>家計簿が「アプリケーション」フォルダ（Chrome Apps）と Launchpad に追加されます</li>
          <li>
            <strong>デスクトップにショートカットを作る</strong>
            <br />Finder で「アプリケーション」→「Chrome Apps」を開き、家計簿を <kbd>option</kbd>+<kbd>command</kbd> を押しながらデスクトップへドラッグ（エイリアス作成）
          </li>
        </ol>
      );
    case 'ios':
      return (
        <ol>
          <li><strong>Safari</strong> でこのページを開く</li>
          <li>画面下の共有ボタン（□に↑）をタップ</li>
          <li>「ホーム画面に追加」→「追加」をタップ</li>
          <li>ホーム画面の「家計簿」アイコンから起動します</li>
        </ol>
      );
    case 'android':
      return (
        <ol>
          <li>Chrome でこのページを開き、上の「インストール」ボタンを押す</li>
          <li>ボタンが無い場合は右上の ⋮ →「アプリをインストール」または「ホーム画面に追加」</li>
          <li>ホーム画面とアプリ一覧に「家計簿」が追加されます</li>
        </ol>
      );
    default:
      return (
        <ol>
          <li>Chrome または Edge でこのページを開き、アドレスバーのインストールアイコンを押す</li>
        </ol>
      );
  }
}

export function InstallSection() {
  const { canPrompt, installed, install } = useInstall();
  const detected = detectPlatform();
  const [platform, setPlatform] = useState<Platform>(detected === 'other' ? 'windows' : detected);
  const [qr, setQr] = useState('');
  const url = appUrl();
  const isLocal = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1f2a27', light: '#ffffff' } }).then(setQr, () => setQr(''));
  }, [url]);

  return (
    <section className="card" id="install">
      <h3>📲 アプリとしてインストール</h3>
      {installed ? (
        <p className="hint">✅ アプリとして起動しています。</p>
      ) : (
        <>
          <p className="muted small">
            パソコンではデスクトップアプリ、スマホではホーム画面のアプリとして使えます。インストール後はオフラインでも起動でき、更新は自動で反映されます。
          </p>
          {canPrompt && (
            <button type="button" className="btn primary install-btn" onClick={install}>
              この{detected === 'android' || detected === 'ios' ? 'スマホ' : 'パソコン'}にインストール
            </button>
          )}
        </>
      )}

      <div className="seg small install-tabs">
        {(['windows', 'mac', 'ios', 'android'] as Platform[]).map((p) => (
          <button type="button" key={p} className={platform === p ? 'on' : ''} onClick={() => setPlatform(p)}>
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="install-steps small"><Steps platform={platform} /></div>

      {detected !== 'ios' && detected !== 'android' && (
        <div className="qr">
          {qr && <img src={qr} alt="スマホ用のQRコード" width={180} height={180} />}
          <div>
            <strong>スマホで取得する</strong>
            <p className="small muted">スマホのカメラでQRコードを読み取ってアプリのページを開き、上の「iPhone / iPad」または「Android スマホ」の手順で追加してください。</p>
            <code className="small">{url}</code>
            {isLocal && <p className="small error">※ 今はこのパソコン内のアドレスです。スマホで使うには公開URL（GitHub Pages）から開いてください。</p>}
          </div>
        </div>
      )}

      <p className="muted small">
        ※ パソコンとスマホで同じデータを使うには、上の「自動同期」を設定してください。
      </p>
    </section>
  );
}

/** ヘッダー用の小さなインストールボタン（インストール可能なときだけ表示） */
export function InstallButton({ onHelp }: { onHelp(): void }) {
  const { canPrompt, installed, install } = useInstall();
  if (installed) return null;
  // iPhone の Safari には確認ダイアログが無いので手順を案内する
  if (!canPrompt && detectPlatform() === 'ios') {
    return (
      <button type="button" className="btn small" onClick={onHelp}>
        📲 ホーム画面に追加
      </button>
    );
  }
  if (!canPrompt) return null;
  return (
    <button type="button" className="btn small primary" onClick={install}>
      📲 インストール
    </button>
  );
}
