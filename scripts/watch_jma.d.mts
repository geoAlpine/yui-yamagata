/**
 * scripts/watch_jma.mjs の判定関数の型。
 * 本体をTypeScriptにしないのは、他の取り込みスクリプトと同じく
 * `node --env-file=` で単体実行できることを優先しているため。
 */
export type JmaVerdict =
  | {
      action: 'switch' | 'notify';
      hazard: string | null;
      label: string;
      /**
       * 正規化・重複排除した警報の種別。気象警報のときだけ入る。
       * 鳴らすかどうかは文書ではなくこれを単位に判断する
       */
      kinds?: string[];
    }
  | null;

/** jma_warning_state の1行のうち、鳴らすかどうかの判断に使う分 */
export type JmaWarningSeen = { last_seen: string; notified_at: string | null };

import type { Pool } from 'pg';

export function judgeQuake(xml: string): JmaVerdict;
export function judgeWarning(xml: string): JmaVerdict;
export function normalizeKind(kind: string): string;
export function shouldRing(
  prev: JmaWarningSeen | null,
  quietHours?: number,
  now?: number
): boolean;

/**
 * まだ鳴らしていない警報だけを返し、見かけたことを記録する。
 * 継続中の警報は last_seen が更新されるだけで、返らない
 */
export function unreportedKinds(pool: Pool, kinds: string[]): Promise<string[]>;
