/**
 * scripts/watch_jma.mjs の判定関数の型。
 * 本体をTypeScriptにしないのは、他の取り込みスクリプトと同じく
 * `node --env-file=` で単体実行できることを優先しているため。
 */
export type JmaVerdict =
  | { action: 'switch' | 'notify'; hazard: string | null; label: string }
  | null;

export function judgeQuake(xml: string): JmaVerdict;
export function judgeWarning(xml: string): JmaVerdict;
