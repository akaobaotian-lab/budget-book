const DIGITS: Record<string, number> = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};
const SMALL_UNITS: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };
const BIG_UNITS: Record<string, number> = { '万': 10_000, '億': 100_000_000 };

/** 全角数字・全角記号を半角に */
export function normalizeWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、](?=\d{3})/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[：]/g, ':')
    .replace(/[／]/g, '/');
}

/**
 * 「1万2000」「二千五百」「3,500」「1.5万」などの数表現を数値に変換。
 * 解釈できなければ null。
 */
export function parseJapaneseNumber(input: string): number | null {
  const s = normalizeWidth(input).replace(/[,\s]/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (!/^[\d.〇零一二三四五六七八九十百千万億]+$/.test(s)) return null;

  let total = 0;
  let section = 0; // 万・億未満の部分
  let current = 0; // 直前の数字
  let numBuf = '';

  const flushNum = () => {
    if (numBuf) {
      current = Number(numBuf);
      numBuf = '';
    }
  };

  for (const ch of s) {
    if (/[\d.]/.test(ch)) {
      numBuf += ch;
    } else if (ch in DIGITS) {
      flushNum();
      current = current * 10 + DIGITS[ch];
    } else if (ch in SMALL_UNITS) {
      flushNum();
      section += (current || 1) * SMALL_UNITS[ch];
      current = 0;
    } else if (ch in BIG_UNITS) {
      flushNum();
      total += (section + current || 1) * BIG_UNITS[ch];
      section = 0;
      current = 0;
    }
  }
  flushNum();
  const result = total + section + current;
  return Number.isFinite(result) ? Math.round(result) : null;
}

const NUM_CHARS = '[\\d,.〇零一二三四五六七八九十百千万億]+';

/** 文中から「◯◯円」の金額をすべて抽出 */
export function extractYenAmounts(text: string): { value: number; index: number; raw: string }[] {
  const s = normalizeWidth(text);
  const re = new RegExp(`(?:¥\\s*(${NUM_CHARS})|(${NUM_CHARS})\\s*円)`, 'g');
  const out: { value: number; index: number; raw: string }[] = [];
  for (const m of s.matchAll(re)) {
    const v = parseJapaneseNumber(m[1] ?? m[2]);
    if (v != null && v > 0) out.push({ value: v, index: m.index ?? 0, raw: m[0] });
  }
  return out;
}
