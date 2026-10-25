import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fetchViaScript, gmailFromShareText, usageToTransaction } from './gmailScript';
import { today } from './date';
import type { MailUsage } from './gmail';

const LAST_CHECK_KEY = 'budget-book-gmail-checked';
/** 自動取り込みの間隔 */
const INTERVAL = 30 * 60 * 1000;

/** 自動で取り込む利用を選ぶ（取り込み済み・接続前の利用は除く） */
export function pickAutoImport(usages: MailUsage[], imported: Set<string>, since?: string): MailUsage[] {
  return usages.filter((u) => !imported.has(u.key) && (!since || u.date >= since));
}

/**
 * アプリを開いたとき（と画面に戻ったとき）に Gmail のカード利用を自動で取り込む。
 * 取り込んだ件数のお知らせを返す。
 */
export function useGmailAutoImport(): [string, () => void] {
  const { data, addTransactions, updateSettings } = useStore();
  const [message, setMessage] = useState('');

  // 他の端末の「スマホでも自動取り込み」のリンク・QRコードから開かれた場合は設定を受け取る
  useEffect(() => {
    if (!location.hash.includes('gmail=')) return;
    const shared = gmailFromShareText(location.hash);
    history.replaceState(history.state, '', location.pathname + location.search);
    if (!shared) return;
    updateSettings({ gmail: { ...latest.current.settings.gmail, ...shared, method: 'script', autoSince: today() } });
    setMessage('✉️ Gmail取り込みを設定しました。これからはアプリを開くと自動で取り込みます');
  }, []);
  const latest = useRef(data);
  latest.current = data;
  const running = useRef(false);

  useEffect(() => {
    const check = async () => {
      const g = latest.current.settings.gmail;
      if (g.method !== 'script' || !g.autoImport || !g.scriptUrl || !g.scriptToken) return;
      if (document.visibilityState !== 'visible' || !navigator.onLine || running.current) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
      } catch {
        // 保存できない環境では毎回確認する
      }
      if (Date.now() - last < INTERVAL) return;
      running.current = true;
      try {
        const { usages } = await fetchViaScript(g.scriptUrl, g.scriptToken, g.query);
        try {
          localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        } catch {
          // 無視
        }
        const imported = new Set(latest.current.transactions.map((t) => t.gmailId).filter((x): x is string => !!x));
        const fresh = pickAutoImport(usages, imported, g.autoSince);
        if (fresh.length) {
          addTransactions(fresh.map((u) => usageToTransaction(u, 'auto')));
          setMessage(`✉️ Gmailからカードの利用を${fresh.length}件取り込みました`);
        }
      } catch {
        // 自動取り込みの失敗は画面を邪魔しない（設定画面の「読み取る」で確認できる）
      } finally {
        running.current = false;
      }
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [addTransactions]);

  return [message, () => setMessage('')];
}
