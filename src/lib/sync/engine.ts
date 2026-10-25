import type { AppData, Recurring, Settings, Transaction } from '../../types';

/**
 * 端末間同期の中核ロジック（通信部分とは独立）。
 *
 * 明細・固定費は1件ずつ別のドキュメントとして保存し、変更のあった項目だけを送る。
 * そのため別の端末で別の明細を同時に編集しても互いに消し合わない。
 * 同じ項目を同時に編集した場合は後に保存された方が残る。
 */

export type Collection = 'transactions' | 'recurring' | 'meta';

export type Op =
  | { type: 'set'; col: Collection; id: string; data: object }
  | { type: 'delete'; col: Collection; id: string };

/** クラウド上の全データ */
export interface RemoteSnapshot {
  transactions: Transaction[];
  recurring: Recurring[];
  settings: Settings | null;
}

export const SETTINGS_ID = 'settings';

/** キー順に依存しない比較用の文字列（undefined は除外） */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/** undefined の項目を取り除く（クラウドに保存できる形にする） */
export function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

const key = (col: Collection, id: string) => `${col}/${id}`;

function docsOf(d: { transactions: Transaction[]; recurring: Recurring[]; settings: Settings | null }) {
  const docs = new Map<string, { col: Collection; id: string; data: object }>();
  for (const t of d.transactions) docs.set(key('transactions', t.id), { col: 'transactions', id: t.id, data: t });
  for (const r of d.recurring) docs.set(key('recurring', r.id), { col: 'recurring', id: r.id, data: r });
  if (d.settings) docs.set(key('meta', SETTINGS_ID), { col: 'meta', id: SETTINGS_ID, data: d.settings });
  return docs;
}

export class SyncEngine {
  /** クラウドにあると分かっている内容（キー → 比較用文字列） */
  private known = new Map<string, string>();
  private ready = false;

  /** 最初のクラウドデータを受け取り、同期を開始できる状態か */
  get isReady() {
    return this.ready;
  }

  /**
   * クラウドからデータが届いたときに呼ぶ。端末に反映するデータを返す。
   * @param firstLink この端末を初めて同期に接続した場合 true。
   *   端末にだけある明細をクラウドに追加する（両方のデータを合わせる）。
   *   2回目以降はクラウドの内容を正とする（オフライン中の変更も送信待ちとしてクラウド側に含まれている）。
   */
  applyRemote(remote: RemoteSnapshot, local: AppData, firstLink: boolean): AppData {
    const wasReady = this.ready;
    // まだ送信していない端末側の変更（送信直前にクラウドの更新が届いた場合など）は残す
    const pending = wasReady ? this.pendingChanges(local) : null;

    this.known = new Map([...docsOf(remote)].map(([k, d]) => [k, stableStringify(d.data)]));
    this.ready = true;

    let transactions = remote.transactions;
    let recurring = remote.recurring;
    let settings = remote.settings ?? local.settings;

    if (!wasReady && firstLink) {
      const remoteTx = new Set(remote.transactions.map((t) => t.id));
      const remoteRec = new Set(remote.recurring.map((r) => r.id));
      transactions = [...transactions, ...local.transactions.filter((t) => !remoteTx.has(t.id))];
      recurring = [...recurring, ...local.recurring.filter((r) => !remoteRec.has(r.id))];
    }

    if (pending) {
      const merge = <T extends { id: string }>(list: T[], col: Collection, localList: T[]): T[] => {
        const map = new Map(list.map((x) => [x.id, x]));
        for (const x of localList) if (pending.set.has(key(col, x.id))) map.set(x.id, x);
        for (const k of pending.del) {
          const [c, id] = k.split('/');
          if (c === col) map.delete(id);
        }
        return [...map.values()];
      };
      transactions = merge(transactions, 'transactions', local.transactions);
      recurring = merge(recurring, 'recurring', local.recurring);
      if (pending.set.has(key('meta', SETTINGS_ID))) settings = local.settings;
    }

    return { ...local, transactions, recurring, settings };
  }

  /** 前回クラウドと一致していた内容から、端末側で変わった項目 */
  private pendingChanges(local: AppData) {
    const set = new Set<string>();
    const del = new Set<string>();
    const docs = docsOf(local);
    for (const [k, d] of docs) if (this.known.get(k) !== stableStringify(d.data)) set.add(k);
    for (const k of this.known.keys()) if (!docs.has(k)) del.add(k);
    return { set, del };
  }

  /** 端末のデータとクラウドの差分を送信内容として返す（返した内容は送信済みとして扱う） */
  diff(local: AppData): Op[] {
    if (!this.ready) return [];
    const ops: Op[] = [];
    const docs = docsOf(local);
    for (const [k, d] of docs) {
      const s = stableStringify(d.data);
      if (this.known.get(k) !== s) {
        ops.push({ type: 'set', col: d.col, id: d.id, data: clean(d.data) });
        this.known.set(k, s);
      }
    }
    for (const k of [...this.known.keys()]) {
      if (!docs.has(k)) {
        const [col, id] = k.split('/') as [Collection, string];
        ops.push({ type: 'delete', col, id });
        this.known.delete(k);
      }
    }
    return ops;
  }

  reset() {
    this.known.clear();
    this.ready = false;
  }
}
