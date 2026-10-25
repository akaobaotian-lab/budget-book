import { makeDate } from './date';
import { normalizeWidth } from './japaneseNumber';

export interface CardUsage {
  date: string;
  amount: number;
  merchant: string;
  card: string;
  /** ご利用内容（「買物」「ショッピング」など） */
  detail?: string;
}

/** 送信元・件名からカード会社を推定 */
export function detectCard(from: string, subject: string): string {
  const s = `${from} ${subject}`;
  const cards: [RegExp, string][] = [
    [/rakuten|楽天/i, '楽天カード'],
    [/smbc|vpass|三井住友/i, '三井住友カード'],
    [/jcb/i, 'JCB'],
    [/aeon|イオン/i, 'イオンカード'],
    [/docomo|dカード|d-card/i, 'dカード'],
    [/epos|エポス/i, 'エポスカード'],
    [/paypay/i, 'PayPayカード'],
    [/americanexpress|amex|アメリカン・?エキスプレス/i, 'AMEX'],
    [/saison|セゾン/i, 'セゾンカード'],
    [/orico|オリコ/i, 'オリコカード'],
    [/mufg|三菱ＵＦＪ|三菱UFJ/i, '三菱UFJカード'],
    [/view|ビューカード/i, 'ビューカード'],
    [/au ?pay|au-pay/i, 'au PAYカード'],
    [/sony|ソニー/i, 'Sony Bank WALLET'],
  ];
  for (const [re, name] of cards) if (re.test(s)) return name;
  return 'クレジットカード';
}

const SEP = '\\s*[:：]?\\s*';
const LABEL_OPEN = '[■◆●・【\\[]?\\s*';
const LABEL_CLOSE = '\\s*[】\\]]?';

function labelled(labels: string): RegExp {
  return new RegExp(`^${LABEL_OPEN}(?:${labels})(?:\\(日本時間\\))?${LABEL_CLOSE}${SEP}(.*)$`);
}

const DATE_LABEL = labelled('ご?利用日時?|利用年月日|ご利用年月日|ご利用日時|お取引日|取引日時?|決済日時?|承認日時?');
const AMOUNT_LABEL = labelled('ご?利用金額|お支払い?金額|決済金額|取引金額|ご請求金額|利用額|承認金額|金額');
const MERCHANT_LABEL = labelled('ご?利用先|ご?利用店舗?名?|ご?利用場所|加盟店名?|店舗名?|ご?購入先');
const DETAIL_LABEL = labelled('ご?利用内容|ご?利用取引|取引内容|ご?利用区分|ご?利用種別|取引区分');

function parseDateValue(v: string): string | null {
  const s = v.replace(/\s/g, '');
  let m = s.match(/(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})/);
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(\d{2})[/.](\d{1,2})[/.](\d{1,2})/);
  if (m) return makeDate(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function parseAmountValue(v: string): number | null {
  const m = v.replace(/\s/g, '').match(/[¥]?([\d,]+)(?:円|JPY)?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return n > 0 ? n : null;
}

function cleanMerchant(v: string): string {
  return v
    .replace(/\s+/g, ' ')
    .replace(/[（(]?(本人|家族)[)）]?$/, '')
    .trim()
    .slice(0, 60);
}

/**
 * カード利用通知メール本文から利用内容を抽出する。
 * 1通に複数件の利用が含まれる場合（楽天カードなど）にも対応。
 * @param fallbackDate 本文に日付がない場合に使う（メール受信日）
 */
export function parseCardMail(body: string, from: string, subject: string, fallbackDate: string): CardUsage[] {
  const card = detectCard(from, subject);
  const lines = normalizeWidth(body)
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: CardUsage[] = [];
  let cur: Partial<CardUsage> = {};

  const flush = () => {
    if (cur.amount) {
      results.push({
        date: cur.date ?? fallbackDate,
        amount: cur.amount,
        merchant: cur.merchant || card,
        card,
        ...(cur.detail ? { detail: cur.detail } : {}),
      });
    }
    cur = {};
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ラベルの次の行に値がある形式にも対応
    const valueOf = (m: RegExpMatchArray | null) => {
      if (!m) return null;
      const v = m[1].trim();
      return v || lines[i + 1] || null;
    };

    const dm = valueOf(line.match(DATE_LABEL));
    if (dm && !/金額/.test(line)) {
      const d = parseDateValue(dm);
      if (d) {
        // 新しい利用の開始
        if (cur.date || cur.amount) flush();
        cur.date = d;
        continue;
      }
    }
    const am = valueOf(line.match(AMOUNT_LABEL));
    if (am && !/合計|累計|請求予定|ご請求予定|利用可能/.test(line)) {
      const a = parseAmountValue(am);
      if (a) {
        if (cur.amount) flush();
        cur.amount = a;
        continue;
      }
    }
    const dt = valueOf(line.match(DETAIL_LABEL));
    if (dt && !cur.detail && !/[¥]?[\d,]+円/.test(dt)) {
      cur.detail = cleanMerchant(dt).slice(0, 30);
      continue;
    }
    const mm = valueOf(line.match(MERCHANT_LABEL));
    if (mm && !cur.merchant && !/[¥]?[\d,]+円/.test(mm)) {
      cur.merchant = cleanMerchant(mm);
      continue;
    }
  }
  flush();

  // ラベル形式で見つからない場合のフォールバック：「◯◯円」の最初の金額。
  // お店のメールなどを誤って取り込まないよう、カード会社からのメールに限る
  if (results.length === 0 && (card !== 'クレジットカード' || /カード|card/i.test(subject))) {
    const m = normalizeWidth(body).match(/([\d,]{2,})\s*円/);
    const amount = m ? Number(m[1].replace(/,/g, '')) : 0;
    if (amount > 0) {
      const dm = normalizeWidth(body).match(/(\d{4})[年/](\d{1,2})[月/](\d{1,2})/);
      const date = dm ? makeDate(Number(dm[1]), Number(dm[2]), Number(dm[3])) : null;
      results.push({ date: date ?? fallbackDate, amount, merchant: card, card });
    }
  }
  return results;
}
