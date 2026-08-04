/**
 * お知らせ（notices）の種別定義。
 *
 * spots/observations が「場所の今の状況」を扱うのに対し、こちらは
 * 主体が期間を区切って出す告知を扱う。記名と連絡先が必須。
 * 詳細な理由は db/004_notices.sql の冒頭コメントを参照。
 */

export type NoticeKind = 'volunteer' | 'need' | 'support';

export interface NoticeKindDef {
  id: NoticeKind;
  label: string;
  /** 投稿フォームに出す注意書き。ここが誤用の唯一の防波堤になる */
  caution: string;
  /** 公式の窓口へ誘導すべき場合のリンク */
  officialLink?: { label: string; href: string };
}

export const NOTICE_KINDS: NoticeKindDef[] = [
  {
    id: 'volunteer',
    label: 'ボランティア募集',
    // 個人が独自に募集して現地に人が殺到すると、受け入れ側が壊れて二次被害になる。
    // 原則は社協の災害ボランティアセンター経由であることを明示する。
    caution:
      '個人の呼びかけによる現地への集中は、受け入れ側の負担になります。まず市町村の災害ボランティアセンターにご相談ください。団体・拠点としての募集のみ掲載します。',
    officialLink: {
      label: '山形県 災害ボランティア情報',
      href: 'https://www.pref.yamagata.jp/020070/kurashi/bousaivolunteer.html',
    },
  },
  {
    id: 'need',
    label: '物資の要望',
    // 「ここに送ってください」は詐欺・転売・過剰供給の入口。
    // 個人宅宛は受け付けない。
    caution:
      '団体・拠点の要望のみ掲載します。個人宅への送付先は掲載できません。品目と数量、受け取り可能な時間帯を具体的に書いてください。',
  },
  {
    id: 'support',
    label: '支援を提供します',
    caution:
      '提供できる内容・条件・連絡先を明記してください。金銭を求めるもの、営業目的のものは掲載できません。',
  },
];

const BY_ID = new Map(NOTICE_KINDS.map((k) => [k.id, k]));

export function getNoticeKind(id: string): NoticeKindDef | undefined {
  return BY_ID.get(id as NoticeKind);
}
