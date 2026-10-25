import type { ExpenseGroup, IncomeType, Kind } from '../types';

export const EXPENSE_CATEGORIES = [
  '食費',
  '外食',
  '日用品',
  '住居',
  '水道光熱',
  '通信',
  '交通',
  '医療',
  '衣服・美容',
  '趣味・娯楽',
  '交際費',
  '教育',
  '保険',
  'サブスク',
  'その他',
] as const;

export const GROUP_LABEL: Record<ExpenseGroup, string> = {
  personal: '自分の買い物',
  living: '生活費',
};

export const INCOME_LABEL: Record<IncomeType, string> = {
  salary: '給与（本業）',
  side: '副業',
  other: 'その他',
};

export const KIND_LABEL: Record<Kind, string> = {
  expense: '支出',
  income: '収入',
  lend: '貸した',
  repay: '返済',
  keiba: '競馬',
};

/** カテゴリから既定の分類を決める */
const LIVING_CATEGORIES = new Set(['食費', '日用品', '住居', '水道光熱', '通信', '交通', '医療', '保険', '教育']);

export function defaultGroupFor(category: string): ExpenseGroup {
  return LIVING_CATEGORIES.has(category) ? 'living' : 'personal';
}

const KEYWORDS: [RegExp, string][] = [
  [/スーパー|イオン|AEON|イトーヨーカドー|西友|ライフ|業務スーパー|まいばすけっと|OK ?ストア|成城石井|食品|生鮮|ヤオコー|サミット/i, '食費'],
  // 商品名（注文確認メールの中身）向け
  [/新米|お米|精米|無洗米|醤油|しょうゆ|味噌|みそ|調味料|食用油|飲料|ミネラルウォーター|天然水|お茶|緑茶|コーヒー豆|菓子|お菓子|チョコ|レトルト|カップ麺|冷凍食品|野菜|果物|フルーツ|肉|魚|卵|牛乳|プロテイン/, '食費'],
  [/ティッシュ|トイレットペーパー|キッチンペーパー|洗剤|柔軟剤|シャンプー|コンディショナー|ボディソープ|歯ブラシ|歯磨き|ゴミ袋|ラップ|電池|マスク|除菌|消臭|芳香剤|スポンジ|おむつ|生理用品/, '日用品'],
  [/イヤホン|ヘッドホン|ケーブル|充電器|モバイルバッテリー|スマホケース|マウス|キーボード|USB|SDカード/i, '趣味・娯楽'],
  [/Tシャツ|シャツ|パンツ|靴下|スニーカー|ジャケット|コート|化粧水|乳液|美容液|ファンデ/i, '衣服・美容'],
  [/医薬品|風邪薬|目薬|サプリ|湿布|絆創膏|体温計/, '医療'],
  [/セブン|ローソン|ファミリーマート|ファミマ|ミニストップ|コンビニ|デイリーヤマザキ/i, '食費'],
  [/ランチ|ディナー|レストラン|カフェ|スタバ|スターバックス|STARBUCKS|ドトール|タリーズ|マクドナルド|マック|吉野家|すき家|松屋|ラーメン|居酒屋|焼肉|寿司|UBER ?EATS|出前館|外食|ガスト|サイゼリヤ/i, '外食'],
  [/マツモトキヨシ|ウエルシア|ツルハ|スギ薬局|ドラッグ|ダイソー|セリア|ニトリ|無印|MUJI|日用品|ホームセンター|カインズ/i, '日用品'],
  [/家賃|管理費|住宅|ローン/i, '住居'],
  [/電気|ガス|水道|東京電力|関西電力|東京ガス|大阪ガス|光熱/i, '水道光熱'],
  [/ドコモ|DOCOMO|ソフトバンク|SOFTBANK|\bAU\b|KDDI|楽天モバイル|ahamo|povo|ワイモバイル|UQ|NTT|光回線|携帯|通信/i, '通信'],
  [/JR|SUICA|PASMO|ICOCA|メトロ|地下鉄|鉄道|バス|タクシー|TAXI|ENEOS|出光|コスモ石油|ガソリン|駐車|交通|高速|ETC/i, '交通'],
  [/病院|クリニック|医院|歯科|薬局|調剤|医療/i, '医療'],
  [/ユニクロ|UNIQLO|\bGU\b|ZARA|H&M|しまむら|美容|ヘア|サロン|衣服|服/i, '衣服・美容'],
  [/NETFLIX|SPOTIFY|AMAZON ?PRIME|プライム|YOUTUBE|DISNEY|HULU|U-NEXT|APPLE\.COM|ICLOUD|GOOGLE ?ONE|サブスク|ADOBE|CHATGPT|OPENAI|ANTHROPIC|CLAUDE/i, 'サブスク'],
  [/映画|ゲーム|STEAM|NINTENDO|任天堂|PLAYSTATION|書店|BOOK|AMAZON|アマゾン|楽天市場|ヨドバシ|ビックカメラ|趣味|カラオケ/i, '趣味・娯楽'],
  [/保険|生命|損保/i, '保険'],
  [/学校|塾|教材|講座|セミナー|教育/i, '教育'],
  [/飲み会|プレゼント|ギフト|ご祝儀|交際/i, '交際費'],
];

/** 店名・メモからカテゴリを推定 */
export function guessCategory(text: string): string {
  for (const [re, cat] of KEYWORDS) {
    if (re.test(text)) return cat;
  }
  return 'その他';
}

/** 文中のカテゴリ名をそのまま拾う */
export function findCategoryName(text: string): string | null {
  for (const c of EXPENSE_CATEGORIES) {
    if (text.includes(c)) return c;
  }
  if (text.includes('光熱費')) return '水道光熱';
  if (text.includes('交通費')) return '交通';
  if (text.includes('医療費')) return '医療';
  if (text.includes('通信費')) return '通信';
  if (text.includes('娯楽') || text.includes('趣味')) return '趣味・娯楽';
  return null;
}
