import type { TaxSettings, Transaction } from '../types';

/**
 * 税金の概算計算（日本の所得税・住民税）。
 * あくまで目安。控除額は令和7年(2025年)分以降の制度をもとにしている。
 */

/** 給与所得控除（2025年分以降） */
export function salaryDeduction(annual: number): number {
  if (annual <= 0) return 0;
  if (annual <= 1_900_000) return Math.min(annual, 650_000);
  if (annual <= 3_600_000) return annual * 0.3 + 80_000;
  if (annual <= 6_600_000) return annual * 0.2 + 440_000;
  if (annual <= 8_500_000) return annual * 0.1 + 1_100_000;
  return 1_950_000;
}

/** 所得税の基礎控除（2025・2026年分） */
export function basicDeductionIncomeTax(totalIncome: number): number {
  if (totalIncome <= 1_320_000) return 950_000;
  if (totalIncome <= 3_360_000) return 880_000;
  if (totalIncome <= 4_890_000) return 680_000;
  if (totalIncome <= 6_550_000) return 630_000;
  if (totalIncome <= 23_500_000) return 580_000;
  if (totalIncome <= 24_000_000) return 480_000;
  if (totalIncome <= 24_500_000) return 320_000;
  if (totalIncome <= 25_000_000) return 160_000;
  return 0;
}

/** 住民税の基礎控除 */
export function basicDeductionResidentTax(totalIncome: number): number {
  if (totalIncome <= 24_000_000) return 430_000;
  if (totalIncome <= 24_500_000) return 290_000;
  if (totalIncome <= 25_000_000) return 150_000;
  return 0;
}

const BRACKETS: [number, number, number][] = [
  // [上限, 税率, 控除額]
  [1_949_000, 0.05, 0],
  [3_299_000, 0.1, 97_500],
  [6_949_000, 0.2, 427_500],
  [8_999_000, 0.23, 636_000],
  [17_999_000, 0.33, 1_536_000],
  [39_999_000, 0.4, 2_796_000],
  [Infinity, 0.45, 4_796_000],
];

/** 課税所得に対する所得税（復興特別所得税 2.1% 込み） */
export function incomeTax(taxable: number): number {
  const t = Math.floor(Math.max(0, taxable) / 1000) * 1000;
  if (t <= 0) return 0;
  const [, rate, ded] = BRACKETS.find(([max]) => t <= max)!;
  return Math.floor((t * rate - ded) * 1.021);
}

/** 給与所得者の副業などが申告不要になる上限（給与以外の所得の合計） */
export const SIDE_INCOME_THRESHOLD = 200_000;
/** 一時所得の特別控除 */
export const TEMPORARY_INCOME_DEDUCTION = 500_000;
/** 住民税の所得割率 */
export const RESIDENT_TAX_RATE = 0.1;

export interface TaxEstimate {
  year: number;
  /** 副業収入 */
  sideRevenue: number;
  /** 副業経費 */
  sideExpenses: number;
  /** 雑所得（副業収入 − 経費） */
  sideIncome: number;
  /** 競馬：購入額合計 */
  keibaPurchase: number;
  /** 競馬：払戻合計 */
  keibaPayout: number;
  /** 競馬：的中馬券の購入額合計（一時所得の経費） */
  keibaHitCost: number;
  /** 一時所得（特別控除50万円後） */
  temporaryIncome: number;
  /** 課税対象となる一時所得（1/2） */
  temporaryTaxable: number;
  /** 給与以外の所得合計（20万円判定に使用） */
  otherIncomeTotal: number;
  /** 給与所得者で20万円以下 → 所得税の確定申告不要 */
  filingExempt: boolean;
  /** あといくらで申告ラインか（超えていれば 0） */
  remainingToThreshold: number;
  /** 副業・競馬によって増える所得税 */
  incomeTax: number;
  /** 副業・競馬によって増える住民税 */
  residentTax: number;
  total: number;
  /** 税金が発生しているか（所得税または住民税） */
  taxOccurred: boolean;
}

export function estimateTax(transactions: Transaction[], year: number, s: TaxSettings): TaxEstimate {
  const inYear = transactions.filter((t) => t.date.startsWith(`${year}-`));
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const sideRevenue = sum(inYear.filter((t) => t.kind === 'income' && t.incomeType === 'side').map((t) => t.amount));
  const sideExpenses = sum(inYear.filter((t) => t.kind === 'expense' && t.sideExpense).map((t) => t.amount));
  const sideIncome = Math.max(0, sideRevenue - sideExpenses);

  const keiba = inYear.filter((t) => t.kind === 'keiba');
  const keibaPurchase = sum(keiba.map((t) => t.amount));
  const keibaPayout = sum(keiba.map((t) => t.payout ?? 0));
  // 的中馬券の購入額が未入力の払戻は、購入額全額を経費とみなさず 0 として扱う（保守的な概算）
  const keibaHitCost = sum(keiba.filter((t) => (t.payout ?? 0) > 0).map((t) => t.hitCost ?? 0));
  const temporaryIncome = Math.max(0, keibaPayout - keibaHitCost - TEMPORARY_INCOME_DEDUCTION);
  const temporaryTaxable = Math.floor(temporaryIncome / 2);

  const otherIncomeTotal = sideIncome + temporaryTaxable;
  const filingExempt = s.salaried && otherIncomeTotal <= SIDE_INCOME_THRESHOLD;
  const remainingToThreshold = s.salaried ? Math.max(0, SIDE_INCOME_THRESHOLD - otherIncomeTotal + 1) : 0;

  // 本業の課税所得
  const salaryIncome = s.salaried ? Math.max(0, s.salaryAnnual - salaryDeduction(s.salaryAnnual)) : 0;
  const social = s.salaried ? s.salaryAnnual * s.socialInsuranceRate : 0;
  const baseTotal = salaryIncome;
  const withTotal = salaryIncome + otherIncomeTotal;

  const taxableIT = (total: number) =>
    total - social - s.otherDeductions - basicDeductionIncomeTax(total);
  const taxableRT = (total: number) =>
    total - social - s.otherDeductions - basicDeductionResidentTax(total);

  const it = filingExempt ? 0 : Math.max(0, incomeTax(taxableIT(withTotal)) - incomeTax(taxableIT(baseTotal)));
  const rt = Math.max(
    0,
    Math.floor(Math.max(0, taxableRT(withTotal)) * RESIDENT_TAX_RATE) -
      Math.floor(Math.max(0, taxableRT(baseTotal)) * RESIDENT_TAX_RATE),
  );

  return {
    year,
    sideRevenue,
    sideExpenses,
    sideIncome,
    keibaPurchase,
    keibaPayout,
    keibaHitCost,
    temporaryIncome,
    temporaryTaxable,
    otherIncomeTotal,
    filingExempt,
    remainingToThreshold,
    incomeTax: it,
    residentTax: rt,
    total: it + rt,
    taxOccurred: it + rt > 0,
  };
}
