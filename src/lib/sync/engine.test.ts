import { describe, expect, it } from 'vitest';
import { SyncEngine, SETTINGS_ID, stableStringify, type Op, type RemoteSnapshot } from './engine';
import type { AppData, Transaction } from '../../types';
import { DEFAULT_SETTINGS } from '../../store';

/** テスト用のクラウド（Firestore の代わり） */
class FakeCloud {
  docs = { transactions: new Map<string, object>(), recurring: new Map<string, object>(), meta: new Map<string, object>() };
  write(ops: Op[]) {
    for (const op of ops) {
      if (op.type === 'set') this.docs[op.col].set(op.id, structuredClone(op.data));
      else this.docs[op.col].delete(op.id);
    }
  }
  snapshot(): RemoteSnapshot {
    return {
      transactions: [...this.docs.transactions.values()].map((d) => structuredClone(d)) as Transaction[],
      recurring: [...this.docs.recurring.values()].map((d) => structuredClone(d)) as AppData['recurring'],
      settings: (this.docs.meta.get(SETTINGS_ID) as AppData['settings']) ?? null,
    };
  }
}

/** テスト用の端末 */
class Device {
  engine = new SyncEngine();
  data: AppData;
  constructor(private cloud: FakeCloud, txs: Transaction[] = []) {
    this.data = { version: 1, transactions: txs, recurring: [], settings: structuredClone(DEFAULT_SETTINGS) };
  }
  connect(firstLink: boolean) {
    this.engine.reset();
    this.receive(firstLink);
  }
  receive(firstLink = false) {
    this.data = this.engine.applyRemote(this.cloud.snapshot(), this.data, firstLink);
    this.push();
  }
  edit(fn: (d: AppData) => AppData) {
    this.data = fn(this.data);
  }
  push() {
    this.cloud.write(this.engine.diff(this.data));
  }
  ids() {
    return this.data.transactions.map((t) => t.id).sort();
  }
}

const tx = (id: string, amount = 100): Transaction => ({
  id, date: '2026-10-01', kind: 'expense', amount, memo: id, source: 'manual', createdAt: 0, group: 'living', category: '食費',
});

describe('SyncEngine', () => {
  it('merges existing data from both devices on first link', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud, [tx('a')]);
    const phone = new Device(cloud, [tx('b')]);
    pc.connect(true);
    phone.connect(true);
    pc.receive();
    expect(pc.ids()).toEqual(['a', 'b']);
    expect(phone.ids()).toEqual(['a', 'b']);
  });

  it('propagates adds, edits and deletes', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud, [tx('a'), tx('b')]);
    const phone = new Device(cloud);
    pc.connect(true);
    phone.connect(true);

    phone.edit((d) => ({ ...d, transactions: [...d.transactions, tx('c')] }));
    phone.push();
    pc.edit((d) => ({ ...d, transactions: d.transactions.map((t) => (t.id === 'a' ? { ...t, amount: 999 } : t)).filter((t) => t.id !== 'b') }));
    pc.push();
    pc.receive();
    phone.receive();

    expect(pc.ids()).toEqual(['a', 'c']);
    expect(phone.ids()).toEqual(['a', 'c']);
    expect(phone.data.transactions.find((t) => t.id === 'a')!.amount).toBe(999);
  });

  it('only sends what changed', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud, [tx('a'), tx('b')]);
    pc.connect(true);
    expect(pc.engine.diff(pc.data)).toEqual([]);
    pc.edit((d) => ({ ...d, transactions: d.transactions.map((t) => (t.id === 'b' ? { ...t, memo: 'x' } : t)) }));
    const ops = pc.engine.diff(pc.data);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'set', col: 'transactions', id: 'b' });
  });

  it('does not resurrect items deleted on another device while this one was closed', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud, [tx('a'), tx('b')]);
    const phone = new Device(cloud);
    pc.connect(true);
    phone.connect(true);
    // スマホを閉じている間にパソコンで削除
    pc.edit((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== 'a') }));
    pc.push();
    // スマホを再起動（2回目以降の接続）
    phone.connect(false);
    expect(phone.ids()).toEqual(['b']);
    expect(cloud.snapshot().transactions.map((t) => t.id)).toEqual(['b']);
  });

  it('keeps a local edit that was not sent yet when a remote update arrives', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud, [tx('a')]);
    const phone = new Device(cloud);
    pc.connect(true);
    phone.connect(true);
    // パソコンで編集（まだ送信していない）中に、スマホの追加が届く
    pc.edit((d) => ({ ...d, transactions: [...d.transactions, tx('mine')] }));
    phone.edit((d) => ({ ...d, transactions: [...d.transactions, tx('theirs')] }));
    phone.push();
    pc.receive();
    expect(pc.ids()).toEqual(['a', 'mine', 'theirs']);
    phone.receive();
    expect(phone.ids()).toEqual(['a', 'mine', 'theirs']);
  });

  it('syncs settings', () => {
    const cloud = new FakeCloud();
    const pc = new Device(cloud);
    const phone = new Device(cloud);
    pc.connect(true);
    phone.connect(true);
    pc.edit((d) => ({ ...d, settings: { ...d.settings, tax: { ...d.settings.tax, salaryAnnual: 5_000_000 } } }));
    pc.push();
    phone.receive();
    expect(phone.data.settings.tax.salaryAnnual).toBe(5_000_000);
  });

  it('stableStringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [1, 2] } })).toBe(stableStringify({ a: { c: [1, 2] }, b: 1 }));
  });
});
