-- お知らせ（notices）: 2つ目にして最後のプリミティブ
--
-- なぜ observations に相乗りさせないか
-- ─────────────────────────────────────────────
-- 「ボランティア募集」「物資が足りない」「支援を提供します」は、
-- 場所の“今の状況”ではない。通りすがりの誰かが目撃するものではなく、
-- 主体（団体・拠点）が期間を区切って出す告知である。
--
-- イマココナビは posts / lifeline / shien / volunteer / requests と
-- 5つのコレクションに分かれ、それぞれ別の描画・別のフォームを持っていた。
-- 災害中に機能を足すとこうなる。平時に作れる利点を活かし、
-- 本サイトはプリミティブを2つに畳む。
--
--   spots ← observations  : 場所の今の状況（誰でも / 匿名 / 目撃ベース）
--   notices               : 主体が出す告知（記名必須 / 連絡先必須 / 期間つき）
--
-- 安全面での決定的な違い:
--   observations は匿名でよい。間違っても「店が開いてなかった」で済む。
--   notices は匿名にしてはいけない。「ここに物資を送ってください」は
--   詐欺・転売・善意の殺到の入口になる。団体名と連絡先を必須にする。

CREATE TABLE IF NOT EXISTS notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,          -- 'volunteer' | 'need' | 'support'
  title        text NOT NULL,
  body         text NOT NULL,

  -- ★匿名を許さない。ここが observations との決定的な違い
  organization text NOT NULL,          -- 団体・拠点の名称
  contact      text NOT NULL,          -- 電話・メール・SNS等

  -- 場所は任意（「市内全域で募集」もあるため）。あれば距離順に出せる
  spot_id      uuid REFERENCES spots(id) ON DELETE SET NULL,
  municipality text,                   -- 市町村名。地域での絞り込みに使う
  location     geography(Point, 4326),

  starts_at    timestamptz,
  ends_at      timestamptz,            -- 期限切れは自動で一覧から落とす

  -- 管理者が連絡先の実在を確認したもの。確認していないものと視覚的に区別する。
  -- 「確認済み」を付けないことが既定であって、付けるのが例外。
  verified_at  timestamptz,
  is_hidden    boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notices_live_idx
  ON notices (kind, created_at DESC)
  WHERE NOT is_hidden;
CREATE INDEX IF NOT EXISTS notices_location_idx ON notices USING GIST (location);

-- ─────────────────────────────────────────────
-- 地域（市町村）での絞り込み。
-- 山形県は35市町村あり、県全域の一覧は災害時に長すぎる。
-- 逆ジオコーディングの外部APIには依存しない（災害時に落ちるものに頼らない）。
-- スポット登録時に静的に持たせる。
-- ─────────────────────────────────────────────
ALTER TABLE spots ADD COLUMN IF NOT EXISTS municipality text;
CREATE INDEX IF NOT EXISTS spots_municipality_idx ON spots (municipality) WHERE is_active;

-- 既存の開発データに市町村を埋める（address の先頭から推定）
UPDATE spots SET municipality =
  CASE
    WHEN address LIKE '山形市%' THEN '山形市'
    WHEN address LIKE '天童市%' THEN '天童市'
    WHEN address LIKE '鶴岡市%' THEN '鶴岡市'
    WHEN address LIKE '酒田市%' THEN '酒田市'
    ELSE NULL
  END
WHERE municipality IS NULL;
