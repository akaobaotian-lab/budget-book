import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { appUrl, detectPlatform, useInstall, type Platform } from '../lib/install';
import { windowsShortcutCmd } from '../lib/desktopShortcut';

const PLATFORM_LABEL: Record<Platform, string> = {
  android: 'Android スマホ',
  windows: 'Windows パソコン',
  mac: 'Mac',
  ios: 'iPhone / iPad',
  other: 'パソコン',
};

function Steps({ platform }: { platform: Platform }) {
  switch (platform) {
    case 'windows':
      return (
        <ol>
          <li>
            <strong>デスクトップにショートカットを作る</strong>：下のボタンでファイルを保存し、保存したファイルをダブルクリック
            <br />
            <DesktopShortcutButton />
            <br />
            <small className="muted">
              「WindowsによってPCが保護されました」と表示されたら「詳細情報」→「実行」を押してください（ショートカットを作るだけのファイルです）。
              デスクトップの「家計簿」から、アプリ専用のウィンドウで開きます。
            </small>
          </li>
          <li>
            スタートメニューやタスクバーにも入れたい場合は、Chrome または Edge で上の「インストール」ボタン（アドレスバー右端のインストールアイコン）も押してください
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
          <li><strong>Chrome</strong> でこのページを開き、上の「このスマホにインストール」ボタンを押す（ボタンが無い場合は右上の ⋮ →「アプリをインストール」）</li>
          <li>ホーム画面とアプリ一覧に「家計簿」が追加され、ほかのアプリと同じように起動できます</li>
          <li>アイコンを長押しすると「明細を追加」「音声で入力」「レシートを撮影」をすぐ開けます</li>
          <li>
            <strong>共有メニューから記録</strong>：ギャラリーのレシート写真や、カード利用通知（Gmail アプリ・LINE など）の文章を
            「共有」→「家計簿」で送ると、読み取って入力画面が開きます
          </li>
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

/** Windows のデスクトップにショートカットを作るファイルを保存する */
export function DesktopShortcutButton() {
  const save = () => {
    const url = appUrl();
    const cmd = windowsShortcutCmd(url, new URL('icons/kakeibo.ico', url).href);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([cmd], { type: 'application/octet-stream' }));
    a.download = 'kakeibo-shortcut.cmd';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <button type="button" className="btn primary shortcut-btn" onClick={save}>
      🖥️ デスクトップにショートカットを作る（Windows）
    </button>
  );
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
        {(['android', 'windows', 'mac', 'ios'] as Platform[]).map((p) => (
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
            <strong>Android スマホで取得する</strong>
            <p className="small muted">スマホのカメラ（または Google レンズ）でQRコードを読み取って Chrome で開き、「インストール」を押してください（上の「Android スマホ」の手順）。</p>
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
