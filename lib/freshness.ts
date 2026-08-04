/**
 * 鮮度の判定。DESIGN.md 3.4 に対応する。
 *
 * 災害時の生活情報は数時間で腐る。「昨日は開いてた」は無情報どころか有害。
 * ここでは経過時間を3段階に落とし、TTLを超えたら状態そのものを「不明」に戻す。
 *
 * 判定は必ず observedAt（実際に見た時刻）を基準にする。createdAt（投稿時刻）ではない。
 * 圏外から戻って後でまとめて投稿する人がいるため、混ぜると誤情報になる。
 */

import { getCategory } from './categories';

export type FreshnessLevel =
  | 'fresh' // 経過 < TTL/3        そのまま信じてよい
  | 'aging' // TTL/3 〜 TTL        古い可能性あり。再確認を促す
  | 'stale'; // > TTL              「不明」に戻す

export interface Freshness {
  level: FreshnessLevel;
  ageMinutes: number;
  ttlMinutes: number;
  /** stale なら状態を伏せる */
  showStatus: boolean;
  /** 再確認ボタンを強調するか */
  emphasizeConfirm: boolean;
}

export function evaluateFreshness(
  categoryId: string,
  observedAt: Date | string,
  now: Date = new Date()
): Freshness {
  const ttlMinutes = getCategory(categoryId)?.ttlMinutes ?? 720;
  const observed = typeof observedAt === 'string' ? new Date(observedAt) : observedAt;
  const ageMinutes = Math.max(0, (now.getTime() - observed.getTime()) / 60000);

  let level: FreshnessLevel;
  if (ageMinutes < ttlMinutes / 3) level = 'fresh';
  else if (ageMinutes < ttlMinutes) level = 'aging';
  else level = 'stale';

  return {
    level,
    ageMinutes: Math.floor(ageMinutes),
    ttlMinutes,
    showStatus: level !== 'stale',
    emphasizeConfirm: level === 'aging',
  };
}

/**
 * 「◯分前に確認」の表示。
 * カードの中で店名の次に目立たせる。状態そのものより鮮度のほうが判断材料になる場面が多い。
 */
export function formatAge(ageMinutes: number): string {
  const m = Math.floor(ageMinutes);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

/** 一覧の並び順に使う重み。新しく、深刻でないものを上に出す */
export function freshnessRank(level: FreshnessLevel): number {
  return { fresh: 0, aging: 1, stale: 2 }[level];
}
