import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppData, Recurring, Settings, Transaction } from './types';
import { generateRecurring } from './lib/recurring';
import { DEFAULT_GMAIL_QUERY } from './lib/gmail';
import { uid } from './lib/format';

const STORAGE_KEY = 'budget-book-v1';

export const DEFAULT_SETTINGS: Settings = {
  tax: { salaried: true, salaryAnnual: 4_000_000, socialInsuranceRate: 0.15, otherDeductions: 0 },
  gmail: { clientId: '', email: '', query: DEFAULT_GMAIL_QUERY },
};

function emptyData(): AppData {
  return { version: 1, transactions: [], recurring: [], settings: DEFAULT_SETTINGS };
}

export function normalizeData(raw: unknown): AppData {
  const d = (raw ?? {}) as Partial<AppData>;
  return {
    version: 1,
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    settings: {
      tax: { ...DEFAULT_SETTINGS.tax, ...d.settings?.tax },
      gmail: { ...DEFAULT_SETTINGS.gmail, ...d.settings?.gmail },
    },
  };
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

/** 固定費の自動記入を適用 */
function applyRecurring(data: AppData): AppData {
  const { transactions, recurring } = generateRecurring(data.recurring);
  if (transactions.length === 0 && recurring.every((r, i) => r === data.recurring[i])) return data;
  return { ...data, transactions: [...data.transactions, ...transactions], recurring };
}

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>;

interface Store {
  data: AppData;
  addTransactions(txs: NewTransaction[]): void;
  updateTransaction(id: string, patch: Partial<Transaction>): void;
  deleteTransaction(id: string): void;
  saveRecurring(r: Recurring): void;
  deleteRecurring(id: string): void;
  updateSettings(patch: Partial<Settings>): void;
  replaceAll(data: AppData): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => applyRecurring(load()));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 保存できない環境（プライベートモード等）ではメモリ上のみ
    }
  }, [data]);

  // 日付が変わったとき・画面に戻ったときに固定費を記入
  useEffect(() => {
    const tick = () => setData((d) => applyRecurring(d));
    const id = window.setInterval(tick, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const addTransactions = useCallback((txs: NewTransaction[]) => {
    const now = Date.now();
    setData((d) => ({
      ...d,
      transactions: [...d.transactions, ...txs.map((t, i) => ({ ...t, id: uid(), createdAt: now + i }))],
    }));
  }, []);

  const updateTransaction = useCallback((id: string, patch: Partial<Transaction>) => {
    setData((d) => ({ ...d, transactions: d.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setData((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) }));
  }, []);

  const saveRecurring = useCallback((r: Recurring) => {
    setData((d) => {
      const exists = d.recurring.some((x) => x.id === r.id);
      const recurring = exists ? d.recurring.map((x) => (x.id === r.id ? r : x)) : [...d.recurring, r];
      return applyRecurring({ ...d, recurring });
    });
  }, []);

  const deleteRecurring = useCallback((id: string) => {
    setData((d) => ({ ...d, recurring: d.recurring.filter((r) => r.id !== id) }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, []);

  const replaceAll = useCallback((next: AppData) => setData(applyRecurring(normalizeData(next))), []);

  const value = useMemo(
    () => ({ data, addTransactions, updateTransaction, deleteTransaction, saveRecurring, deleteRecurring, updateSettings, replaceAll }),
    [data, addTransactions, updateTransaction, deleteTransaction, saveRecurring, deleteRecurring, updateSettings, replaceAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider がありません');
  return s;
}
