import { guessCategory } from './categories';
import { makeDate } from './date';
import { normalizeWidth } from './japaneseNumber';

export interface ParsedReceipt {
  date: string | null;
  amount: number | null;
  store: string;
  category: string;
}

const ERA_BASE: Record<string, number> = { R: 2018, 令和: 2018, H: 1988, 平成: 1988 };

function toNumber(s: string): number {
  return Number(s.replace(/[,\s.]/g, ''));
}

/** OCR の誤認識しやすい文字を補正 */
function fixOcr(line: string): string {
  return normalizeWidth(line)
    .replace(/[¥羊半]\s*(?=\d)/g, '¥')
    .replace(/(?<=\d)[oO]/g, '0')
    .replace(/(?<=\d)[lI|]/g, '1')
    .replace(/(?<=\d)\s+(?=\d{3}\b)/g, '')
    // OCRが日本語の文字間に入れる空白を除去
    .replace(/(?<=[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー])\s+(?=[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー])/gu, '');
}

function findDate(lines: string[]): string | null {
  for (const line of lines) {
    const s = line.replace(/\s/g, '');
    let m = s.match(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})/);
    if (m) {
      const d = makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
      if (d) return d;
    }
    m = s.match(/(令和|R|平成|H)(\d{1,2}|元)[年/.\-](\d{1,2})[月/.\-](\d{1,2})/);
    if (m) {
      const y = ERA_BASE[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
      const d = makeDate(y, Number(m[3]), Number(m[4]));
      if (d) return d;
    }
    m = s.match(/(?<!\d)(\d{2})[/.](\d{1,2})[/.](\d{1,2})(?!\d)/);
    if (m) {
      const d = makeDate(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
      if (d) return d;
    }
  }
  return null;
}

const AMOUNT = '[¥]?\\s*([\\d][\\d,. ]*\\d|\\d)\\s*円?';

function findAmount(lines: string[]): number | null {
  // 優先度の高いキーワード順に探す
  const priorities: RegExp[] = [
    /合\s*計|総\s*計|お買上げ?計|お買い?上げ?金額|ご請求額|お支払い?金?額|領収金額/,
    /お預り?|クレジット|カード|電子マネー|現金/,
    /小\s*計/,
  ];
  for (const key of priorities) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!key.test(line) || /税|対象|内消費|お釣|釣銭|ポイント/.test(line.replace(key, ''))) continue;
      const after = line.slice(line.search(key));
      const m = after.match(new RegExp(AMOUNT + '\\s*$')) ?? after.match(new RegExp(AMOUNT));
      if (m) {
        const v = toNumber(m[1]);
        if (v > 0) return v;
      }
      // 金額が次の行に出ることがある
      const next = lines[i + 1]?.match(new RegExp(`^${AMOUNT}$`));
      if (next) return toNumber(next[1]);
    }
  }
  // キーワードがなければ ¥ 付きの最大金額
  let max = 0;
  for (const line of lines) {
    for (const m of line.matchAll(/¥\s*([\d,]+)/g)) max = Math.max(max, toNumber(m[1]));
  }
  return max || null;
}

function findStore(lines: string[]): string {
  for (const line of lines.slice(0, 6)) {
    const s = line.trim();
    if (s.length < 2) continue;
    if (/領収|レシート|receipt|TEL|電話|〒|\d{2,4}-\d{2,4}-\d{3,4}|登録番号|^\d/i.test(s)) continue;
    if (/^[\p{P}\p{S}\s\d]+$/u.test(s)) continue;
    return s.replace(/[\s　]+/g, ' ');
  }
  return '';
}

/** レシートのOCR結果から日付・合計金額・店名を推定 */
export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map(fixOcr)
    .map((l) => l.trim())
    .filter(Boolean);
  const store = findStore(lines);
  return {
    date: findDate(lines),
    amount: findAmount(lines),
    store,
    category: guessCategory(store + ' ' + lines.slice(0, 10).join(' ')),
  };
}
