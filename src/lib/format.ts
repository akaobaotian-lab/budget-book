const yenFormatter = new Intl.NumberFormat('ja-JP');

export function yen(n: number): string {
  return `${n < 0 ? '-' : ''}¥${yenFormatter.format(Math.abs(Math.round(n)))}`;
}

/** 符号付き表示（収支用） */
export function signedYen(n: number): string {
  return n > 0 ? `+${yen(n)}` : yen(n);
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
