-- 雪モードの廃止（2026-08-05）
--
-- 「平時＝雪 / 有事＝災害」の二段構えをやめ、災害専用にする。理由は
-- lib/categories.ts の冒頭コメントを参照（Googleに勝てない領域だった、
-- 除雪は区間データで点では表現できない、報告の動機が弱い、など）。
--
-- 平時は 'standby'（そなえ）とし、給水拠点や自家発電付き給油所の位置を
-- 確認できる場にする。Googleが持っていない情報だけを出す。

UPDATE site_state SET mode = 'standby' WHERE mode = 'snow';
ALTER TABLE site_state ALTER COLUMN mode SET DEFAULT 'standby';

-- 雪カテゴリのスポットがあれば無効化する（観測は履歴として残す）
UPDATE spots SET is_active = false
 WHERE category IN ('snow_clear', 'road_surface', 'road_winter', 'roof_snow');
