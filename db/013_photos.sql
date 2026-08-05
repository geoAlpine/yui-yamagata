-- 写真（2026-08-05）
--
-- 行列や貼り紙の写真1枚が持つ説得力は大きい。イマココナビにも無かった機能。
--
-- ── 容量より先に片付けるべき2つ ──
--  1. EXIFに撮影場所が入る。避難所や自宅で撮った写真をそのまま上げると
--     投稿者の居場所が公開される。匿名投稿の意味がなくなる。
--     → クライアントでcanvasに再描画してEXIFを落とす（圧縮のついで）
--  2. 顔とナンバープレート。技術では解決できないので、投稿前の警告と
--     事後の通報・削除で対処する。
--
-- ── 容量 ──
-- 長辺1280px・WebPで1枚150KB程度。1週間の災害で0.7GB、最悪でも1.4GB。
-- VPSの空きは89GBなので問題にならない。
-- ただし放置すると際限なく増えるので、期限で消す。
-- 2時間で腐る情報に付いた写真は、翌日には価値がない。
ALTER TABLE observations ADD COLUMN IF NOT EXISTS photo_bytes int;
CREATE INDEX IF NOT EXISTS observations_photo_idx
  ON observations (created_at) WHERE photo_path IS NOT NULL;
