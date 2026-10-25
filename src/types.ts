/** 明細の種類 */
export type Kind = 'expense' | 'income' | 'lend' | 'repay' | 'keiba';

/** 支出の分類：自分の買い物 / 生活費 */
export type ExpenseGroup = 'personal' | 'living';

/** 収入の種類：本業(給与) / 副業 / その他(非課税など) */
export type IncomeType = 'salary' | 'side' | 'other';

export type Source = 'manual' | 'voice' | 'receipt' | 'gmail' | 'recurring';

export interface Transaction {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  kind: Kind;
  /** 金額。競馬の場合は購入額 */
  amount: number;
  memo: string;
  source: Source;
  createdAt: number;

  /** kind = expense */
  group?: ExpenseGroup;
  category?: string;
  /** 副業の経費として計上する */
  sideExpense?: boolean;

  /** kind = income */
  incomeType?: IncomeType;

  /** kind = lend / repay：相手の名前 */
  person?: string;

  /** kind = keiba：払戻額 */
  payout?: number;
  /** kind = keiba：払戻を受けた（的中した）馬券の購入額。税金計算に使用 */
  hitCost?: number;

  /** source = gmail：取り込み元メッセージID（重複防止） */
  gmailId?: string;
  /** source = recurring：固定費ID */
  recurringId?: string;
}

/** 毎月の固定支払い（収入も可） */
export interface Recurring {
  id: string;
  name: string;
  amount: number;
  /** 毎月の支払日 (1-31)。月末を超える場合は月末日 */
  day: number;
  kind: 'expense' | 'income';
  group?: ExpenseGroup;
  category?: string;
  incomeType?: IncomeType;
  active: boolean;
  /** 登録した月 YYYY-MM。この月から記入を開始 */
  startMonth: string;
  /** 最後に自動記入した月 YYYY-MM */
  lastGenerated?: string;
}

export interface TaxSettings {
  /** 給与所得者か（副業20万円ルールの判定に使用） */
  salaried: boolean;
  /** 本業の年収（額面） */
  salaryAnnual: number;
  /** 社会保険料の概算率（年収に対する割合） */
  socialInsuranceRate: number;
  /** その他の所得控除合計（生命保険料控除・扶養控除など） */
  otherDeductions: number;
}

export interface GmailSettings {
  /** Google Cloud で発行した OAuth クライアントID */
  clientId: string;
  /** 家計簿に登録した Gmail アドレス */
  email: string;
  /** 検索クエリ */
  query: string;
  lastImportedAt?: number;
}

export interface Settings {
  tax: TaxSettings;
  gmail: GmailSettings;
}

export interface AppData {
  version: 1;
  transactions: Transaction[];
  recurring: Recurring[];
  settings: Settings;
}
