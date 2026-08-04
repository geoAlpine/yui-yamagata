-- 山形防災 生活情報共有サイト スキーマ
-- DESIGN.md 3.2 に対応
--
-- 中核: 「投稿一覧」ではなく「場所に観測が積み重なる」構造にする。
--   spots ──< observations ──< confirmations
-- 同じ店に何人が報告しても1つのカードにまとまり、状況の推移が履歴として残る。

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- 場所。原則として使い回される。平時に事前登録できることが最大の価値。
-- 有事には「状況を報告する」だけになり、ゼロから投稿するより速く、位置ズレも起きない。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL,                       -- lib/categories.ts の CategoryDef.id
  -- geography を使う（geometry ではなく）。距離がメートルで直接出るため、
  -- 「近い順」を投影法を気にせず書ける。
  location    geography(Point, 4326) NOT NULL,
  address     text,
  source      text NOT NULL DEFAULT 'user',        -- 'official' | 'user' | 'imported'
  -- 停電時も給油できる経産省指定の給油所など、災害時に価値の高い区分を立てる
  is_priority boolean NOT NULL DEFAULT false,
  note        text,                                -- 場所そのものの補足（営業時間など）
  is_active   boolean NOT NULL DEFAULT true,       -- 閉店・廃止
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 「現在地から近い順」はトップページの既定の並び順。必ず効かせる。
CREATE INDEX IF NOT EXISTS spots_location_idx ON spots USING GIST (location);
CREATE INDEX IF NOT EXISTS spots_category_idx ON spots (category) WHERE is_active;

-- ─────────────────────────────────────────────
-- 観測。「私は◯時にここを見て、こうだった」という一件の目撃。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spot_id        uuid NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  status         text NOT NULL,                    -- CategoryDef.statuses[].id
  -- ★ observed_at と created_at は必ず分ける。
  --   observed_at = 実際に見た時刻 / created_at = 送信された時刻。
  --   圏外から戻って後でまとめて投稿する人がいるため、混ぜると誤情報になる。
  observed_at    timestamptz NOT NULL DEFAULT now(),
  attrs          jsonb NOT NULL DEFAULT '{}'::jsonb, -- 待ち時間・給油上限など
  note           text,                             -- 80字上限（アプリ側で制限）
  photo_path     text,
  reporter_token text NOT NULL,                    -- 端末ローカルID（匿名）
  is_hidden      boolean NOT NULL DEFAULT false,   -- 管理者による非表示
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 「その場所の最新の観測」を引くための索引。全ページで最も多用する経路。
CREATE INDEX IF NOT EXISTS observations_spot_observed_idx
  ON observations (spot_id, observed_at DESC) WHERE NOT is_hidden;
CREATE INDEX IF NOT EXISTS observations_token_created_idx
  ON observations (reporter_token, created_at DESC);

-- ─────────────────────────────────────────────
-- 追認・否認。1タップで完結させる「まだこの状況ですか？」の受け皿。
-- 事前審査をしない代わりに、事後の集合知で補正する（DESIGN.md 6章）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS confirmations (
  observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  reporter_token text NOT NULL,
  agrees         boolean NOT NULL,                 -- true=まだそう / false=違う
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, reporter_token)     -- 同一端末の二重投票を防ぐ
);

CREATE INDEX IF NOT EXISTS confirmations_observation_idx ON confirmations (observation_id);

-- ─────────────────────────────────────────────
-- サイト全体のモード。平時（雪）/ 有事（災害）を切り替える。
-- 自動切替はしない。誤爆したときの信頼失墜が回復不能なため（DESIGN.md 4章）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_state (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),  -- 1行しか作れない
  mode       text NOT NULL DEFAULT 'standby',                 -- 'standby'（平時＝そなえ） | 'disaster'
  notice     text,                                         -- 全ページ上部の告知
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_state (id, mode) VALUES (true, 'standby') ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 通報。人力で見る唯一のキュー。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid REFERENCES observations(id) ON DELETE CASCADE,
  spot_id        uuid REFERENCES spots(id) ON DELETE CASCADE,
  reason         text NOT NULL,
  reporter_token text NOT NULL,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_open_idx ON reports (created_at DESC) WHERE resolved_at IS NULL;
