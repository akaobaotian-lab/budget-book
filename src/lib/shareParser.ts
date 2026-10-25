import { defaultGroupFor, guessCategory } from './categories';
import { parseCardMail } from './cardMailParser';
import { today as todayFn } from './date';
import { parseVoiceText, type ParsedEntry } from './voiceParser';

/**
 * 共有メニューから送られたテキストを明細にする。
 * カード会社の利用通知（Gmail アプリの本文・プッシュ通知など）なら利用内容を、
 * それ以外は音声入力と同じ書き方（「昨日ランチ1200円」など）として読み取る。
 */
export function parseSharedText(text: string, base: string = todayFn()): ParsedEntry {
  if (/利用|ご請求|決済|カード|card/i.test(text)) {
    // プッシュ通知などで1行にまとまっている場合は、項目ごとに改行して読み取る
    const lines = text
      .replace(/\s*(?=[■◆●【])/g, '\n')
      .replace(/\s+(?=(?:ご)?利用(?:日|金額|先|場所|店)|お支払い?金額|決済金額|加盟店)/g, '\n');
    const [usage] = parseCardMail(lines, text, '', base);
    if (usage) {
      const category = guessCategory(usage.merchant);
      return {
        kind: 'expense',
        date: usage.date,
        amount: usage.amount,
        memo: usage.merchant,
        category,
        group: defaultGroupFor(category),
      };
    }
  }
  return parseVoiceText(text.replace(/\s+/g, ' '), base);
}
