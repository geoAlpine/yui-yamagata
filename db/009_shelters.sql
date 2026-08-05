-- 指定緊急避難場所・指定避難所（2026-08-05）
--
-- 当初「避難所の網羅DBは作らない」としていたが、これは半分誤りだった。
--
--   どこにあるか（指定）  … 公式が持っている。同じものを持てる
--   今開いているか        … 発災後に自治体が発表するが更新が遅い。住民の目撃が先行する
--
-- 「指定されている」と「今開いている」は別物で、後者はまさに
-- spots ← observations のモデルが得意とするところ。持たない理由がない。
--
-- ただし2種類を混同してはいけない。国土地理院自身が違いの理解を求めている。
--   指定緊急避難場所 … 発災時に緊急で逃げる場所。災害種別ごとに指定される
--   指定避難所       … 災害後に滞在する場所
-- 地震向けに指定された場所が洪水では使えないことがある。種別を必ず保持する。

ALTER TABLE spots ADD COLUMN IF NOT EXISTS hazards text[];
COMMENT ON COLUMN spots.hazards IS
  '指定緊急避難場所が対応する災害種別。flood/landslide/storm_surge/earthquake/tsunami/fire/inland_flood/volcano';
CREATE INDEX IF NOT EXISTS spots_hazards_idx ON spots USING GIN (hazards) WHERE is_active;

-- 国土地理院の共通IDで一意にする。再取り込みで重複させない。
ALTER TABLE spots ADD COLUMN IF NOT EXISTS gsi_id text;
CREATE UNIQUE INDEX IF NOT EXISTS spots_gsi_uniq ON spots (gsi_id) WHERE gsi_id IS NOT NULL;
