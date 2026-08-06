-- 災害モードの自動切替を記録する（2026-08-06）
--
-- ── なぜ自動化するか ──
-- 当初は「自動切替はしない」としていた。誤爆したときの信頼失墜が
-- 回復不能だから、という理由で、これ自体は正しい懸念だった。
--
-- ただし対称に考えていた。
--   誤って切り替える  → 「大げさだな」と思われる。訂正できる
--   切り替え損ねる    → 災害時に平時モードのまま。取り返しがつかない
-- 釣り合っていない。深夜に地震が起きたとき、運営者が寝ていたら、
-- あるいは運営者自身が被災していたら、誰も切り替えられない。
-- 災害のために作ったサイトが災害時に平時モードのままになる。
--
-- ── 非対称にする ──
--   オンは自動   気象庁の発表を検知したら切り替える
--   オフは手動   自動では戻さない。「もう大丈夫」を機械に判断させない
--
-- 災害モードが本当に必要なのは発災の数時間後から数日後。気象庁の情報が
-- 落ち着いた時点で戻すと、断水や物資不足が続くいちばん必要な時期に
-- 平時モードへ戻ってしまう。戻すのは人が確かめてから /admin で行う。
--
-- しきい値は「震度5弱以上」と「特別警報」。年に0〜1回の頻度で、
-- この水準なら「大げさだった」となる誤爆はほぼ起きない。
-- 土砂災害警戒情報や警報はメール通知だけにして、人が判断する。
--
-- ── 気象庁が落ちていたら何もしない ──
-- 取得に失敗しても現状維持。勝手に平時へ戻さない。
-- 外部サービスの障害が、こちらの表示を壊してはいけない。

ALTER TABLE site_state ADD COLUMN IF NOT EXISTS auto_switched_at timestamptz;
ALTER TABLE site_state ADD COLUMN IF NOT EXISTS auto_reason text;

COMMENT ON COLUMN site_state.auto_switched_at IS
  '自動で災害モードに切り替えた時刻。手動切替では NULL のまま';
COMMENT ON COLUMN site_state.auto_reason IS
  '切替の根拠（例: 山形県で最大震度5強を観測（気象庁 2026-08-06 03:20））。'
  '利用者にも表示する。なぜこの表示になっているかを隠さない';

-- 気象庁の発表をどこまで処理したかを覚える。
-- 同じ発表で何度も切り替えたり、通知を繰り返し送らないため。
CREATE TABLE IF NOT EXISTS jma_seen (
  -- 気象庁XMLの <id>。発表ごとに一意
  event_id   text PRIMARY KEY,
  title      text NOT NULL,
  published  timestamptz NOT NULL,
  -- 'switched'（災害モードにした） | 'notified'（通知のみ） | 'ignored'
  action     text NOT NULL,
  seen_at    timestamptz NOT NULL DEFAULT now()
);

-- 古い記録は消す。増え続ける理由がない
CREATE INDEX IF NOT EXISTS jma_seen_seen_at_idx ON jma_seen (seen_at);

-- 取得状態。ETag を覚えて条件付きGETを使う。
-- 気象庁のフィードは cache-control: max-age=60 を返すので毎分の確認が想定内だが、
-- 変化がないのに毎回30KBを落とすのは礼を欠く。304 で済ませる。
CREATE TABLE IF NOT EXISTS jma_feed (
  feed          text PRIMARY KEY,          -- 'eqvol' | 'extra'
  etag          text,
  last_modified text,
  checked_at    timestamptz,
  -- 連続で失敗しているかを見る。気象庁が落ちているのか、こちらが壊れたのか
  failures      int NOT NULL DEFAULT 0,
  last_error    text
);
INSERT INTO jma_feed (feed) VALUES ('eqvol'), ('extra') ON CONFLICT DO NOTHING;
