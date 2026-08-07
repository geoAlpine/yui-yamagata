-- 管理者パスワードを初回アクセス時に設定できるようにする（2026-08-07）
--
-- これまでは環境変数 ADMIN_PASSWORD 1本だった。運用者が1〜2名である間は
-- それで足りていたが、他県がこのコードを使う場合（README「他の都道府県で使う」）、
-- サーバに入って env を書くまで管理画面に入れない。導入の敷居を下げる。
--
-- 平文は持たない。pgcrypto の bcrypt で保存する。
-- pgcrypto は 001_schema.sql で有効化済み。
--
-- ★環境変数は残す。既存の本番は ADMIN_PASSWORD が設定されているので、
--   この列が NULL のままでも従来どおり動く。移行を強制しない。
ALTER TABLE site_state ADD COLUMN IF NOT EXISTS admin_password_hash text;

COMMENT ON COLUMN site_state.admin_password_hash IS
  'bcrypt ハッシュ。NULL なら環境変数 ADMIN_PASSWORD にフォールバックする。'
  '両方とも無い場合だけ、/admin が初期設定の画面になる。';
