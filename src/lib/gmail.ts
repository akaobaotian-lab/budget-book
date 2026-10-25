import { parseCardMail, type CardUsage } from './cardMailParser';
import { toISODate } from './date';

/**
 * Gmail API（読み取り専用）でカード利用通知メールを取得する。
 * ブラウザだけで完結し、トークンはメモリ上にのみ保持する。
 */

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const DEFAULT_GMAIL_QUERY =
  'subject:(利用 OR ご利用 OR 速報 OR 決済) (カード OR card) newer_than:60d';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string; login_hint?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            login_hint?: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let token: { value: string; expiresAt: number } | null = null;
let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Googleのログインスクリプトを読み込めませんでした'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Googleにログインしてアクセストークンを取得 */
export async function authorize(clientId: string, email?: string, forcePrompt = false): Promise<string> {
  if (!clientId) throw new Error('設定画面で Google OAuth クライアントID を入力してください');
  if (!forcePrompt && token && token.expiresAt > Date.now() + 60_000) return token.value;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      login_hint: email || undefined,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error || 'ログインに失敗しました'));
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.message || 'ログインがキャンセルされました')),
    });
    client.requestAccessToken({ prompt: forcePrompt ? 'consent' : '', login_hint: email || undefined });
  });
}

export function signOut() {
  if (token && window.google) window.google.accounts.oauth2.revoke(token.value);
  token = null;
}

async function api<T>(path: string): Promise<T> {
  if (!token) throw new Error('Gmailにログインしていません');
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token.value}` } });
  if (res.status === 401) {
    token = null;
    throw new Error('ログインの有効期限が切れました。もう一度ログインしてください');
  }
  if (!res.ok) throw new Error(`Gmail API エラー (${res.status})`);
  return res.json() as Promise<T>;
}

export async function getProfileEmail(): Promise<string> {
  const p = await api<{ emailAddress: string }>('/profile');
  return p.emailAddress;
}

interface Header { name: string; value: string }
interface Part {
  mimeType: string;
  headers?: Header[];
  body?: { data?: string; size?: number };
  parts?: Part[];
}
interface Message {
  id: string;
  internalDate: string;
  payload: Part;
}

function decodeBase64Url(data: string, charset: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function charsetOf(part: Part): string {
  const ct = part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
  return ct.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&yen;/g, '¥')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractBody(part: Part): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: Part) => {
    if (p.body?.data) {
      if (p.mimeType === 'text/plain') plain.push(decodeBase64Url(p.body.data, charsetOf(p)));
      else if (p.mimeType === 'text/html') html.push(decodeBase64Url(p.body.data, charsetOf(p)));
    }
    p.parts?.forEach(walk);
  };
  walk(part);
  return plain.length ? plain.join('\n') : htmlToText(html.join('\n'));
}

export interface MailUsage extends CardUsage {
  messageId: string;
  /** 1通に複数件ある場合の連番 */
  key: string;
  subject: string;
}

/** 検索クエリに一致するメールからカード利用を抽出 */
export async function fetchCardUsages(
  query: string,
  onProgress?: (done: number, total: number) => void,
  max = 100,
): Promise<MailUsage[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ q: query, maxResults: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const list = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${q}`);
    list.messages?.forEach((m) => ids.push(m.id));
    pageToken = list.nextPageToken;
  } while (pageToken && ids.length < max);

  const target = ids.slice(0, max);
  const out: MailUsage[] = [];
  let done = 0;
  // 同時取得数を抑えて順に取得
  const CONCURRENCY = 5;
  for (let i = 0; i < target.length; i += CONCURRENCY) {
    const batch = await Promise.all(target.slice(i, i + CONCURRENCY).map((id) => api<Message>(`/messages/${id}?format=full`)));
    for (const msg of batch) {
      const header = (n: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
      const subject = header('subject');
      const from = header('from');
      const received = toISODate(new Date(Number(msg.internalDate)));
      parseCardMail(extractBody(msg.payload), from, subject, received).forEach((u, idx) =>
        out.push({ ...u, messageId: msg.id, key: `${msg.id}#${idx}`, subject }),
      );
    }
    done += batch.length;
    onProgress?.(done, target.length);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
