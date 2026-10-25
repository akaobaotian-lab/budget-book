const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  return toISODate(new Date());
}

/** YYYY-MM */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function currentMonth(): string {
  return monthOf(today());
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** 月の日付 day を返す。月末を超える場合は月末日に丸める */
export function dateInMonth(month: string, day: number): string {
  const d = Math.min(Math.max(1, day), daysInMonth(month));
  return `${month}-${pad(d)}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${w})`;
}

/** 年月日を検証して YYYY-MM-DD を返す。不正なら null */
export function makeDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}

export function shiftDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + delta));
}
