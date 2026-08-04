-- 外部データの取り込み用。
--
-- 再取り込みしても重複しないよう、OSMの要素IDを持たせる。
-- 取り込み後に利用者が状況を報告していくので、スポットを消して作り直す運用は取れない
-- （observations が ON DELETE CASCADE で消えてしまう）。必ず upsert する。
ALTER TABLE spots ADD COLUMN IF NOT EXISTS osm_type text;   -- node | way | relation
ALTER TABLE spots ADD COLUMN IF NOT EXISTS osm_id   bigint;
CREATE UNIQUE INDEX IF NOT EXISTS spots_osm_uniq ON spots (osm_type, osm_id)
  WHERE osm_id IS NOT NULL;

-- 取り込みの進捗。Overpass は混雑で 429/504 を返すため一発で終わる前提に立てない。
-- 「その市町村のスポットが既にあるか」で再開を判定すると、addr:city が付いていた
-- 大きな市が処理済みと誤判定される。処理そのものを記録する。
CREATE TABLE IF NOT EXISTS import_progress (
  key     text PRIMARY KEY,
  done_at timestamptz NOT NULL DEFAULT now()
);
