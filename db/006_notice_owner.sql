-- お知らせの「終了しました」報告のために、投稿者と終了時刻を持たせる
--
-- 掲載期限だけでは足りない。期限内に物資が足りたり募集が埋まったりしたとき、
-- 古い募集が残り続けるのは「古い情報を配る」のと同じ害になる。
-- ただし誰でも他人の募集を閉じられてはいけないので、
-- 署名付き匿名ID（lib/identity.ts）と一致した場合のみ閉じられるようにする。
ALTER TABLE notices ADD COLUMN IF NOT EXISTS owner_token text;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS closed_at timestamptz;
CREATE INDEX IF NOT EXISTS notices_owner_idx ON notices (owner_token);
