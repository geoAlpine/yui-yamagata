-- 署名付きcookie方式への移行と、管理機能まわり

-- 追認にIPを持たせる。cookieは消せば作り直せるため、IPでも歯止めをかける。
-- ※Cloudflare経由では nginx の set_real_ip_from を先に設定しないと
--   全員が同じIPに見え、この列が無意味になる。
ALTER TABLE confirmations ADD COLUMN IF NOT EXISTS ip text;
CREATE INDEX IF NOT EXISTS confirmations_ip_created_idx ON confirmations (ip, created_at DESC);

ALTER TABLE observations ADD COLUMN IF NOT EXISTS ip text;

-- スポットの重複登録を抑える。同じ場所が二重に立つと観測が分散し、
-- 「場所に観測が積み重なる」という設計の利点が消える。
CREATE INDEX IF NOT EXISTS spots_dedup_idx ON spots USING GIST (location) WHERE is_active;

-- 利用者が追加したスポットは、公式取り込みと区別できるようにしておく
-- （source 列で既に区別できるが、明示的に検索するための索引）
CREATE INDEX IF NOT EXISTS spots_source_idx ON spots (source, created_at DESC);

-- 場所の量産を止めるため、作成元IPを持たせる
ALTER TABLE spots ADD COLUMN IF NOT EXISTS created_ip text;
CREATE INDEX IF NOT EXISTS spots_created_ip_idx ON spots (created_ip, created_at DESC);
