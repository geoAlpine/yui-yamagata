-- 名前・住所での検索（2026-08-05）
--
-- 6,699件に増えたことで、距離順だけでは目的の場所に辿り着けなくなった。
-- 「ヤマザワ」「琢成小学校」のように名前が分かっているときは、
-- 近い順に50件めくるより検索したほうが速い。
--
-- pg_trgm を使う。日本語でも部分一致（ILIKE '%q%'）に索引が効くようになり、
-- 全表走査を避けられる。表記ゆれにもある程度耐える。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS spots_name_trgm_idx ON spots USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS spots_address_trgm_idx ON spots USING GIN (address gin_trgm_ops);
