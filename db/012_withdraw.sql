-- 投稿の取り消し（2026-08-05）
--
-- イマココナビは投稿の編集・削除ができる。うちは一度出したら直せなかった。
-- 災害時に急いで押すのだから、押し間違いは必ず起きる。
-- 「品薄」のつもりが「休業」だった、を訂正できないのは実害がある。
--
-- ただし履歴は消さない。「12:00 開いてた → 15:00 閉まってた」という
-- 推移そのものが情報だという設計は変えない。
-- 取り消しは is_hidden で行い、行は残す。
--
-- 誰が取り消せるか: 投稿した本人だけ。署名付き匿名ID（reporter_token）で判定する。
-- 他人の報告を消せると、正しい情報を消す手段になる。
ALTER TABLE observations ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
COMMENT ON COLUMN observations.withdrawn_at IS
  '投稿者本人が取り消した時刻。管理者による is_hidden とは区別する';
CREATE INDEX IF NOT EXISTS observations_reporter_idx
  ON observations (reporter_token, created_at DESC);
