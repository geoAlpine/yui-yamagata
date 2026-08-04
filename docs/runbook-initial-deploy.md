# 初回デプロイ手順書

対象VPS: `210.131.217.236`（Ubuntu 24.04 / 4vCPU / 6GB / 145GB）

**このVPSには商用サイトが9つ同居している**（yukemuri-coffee.com、smart-agri-vision.net、
geoalpine.net ほか）。作業はすべて「既存を壊さない」を最優先に組んである。
既存のMySQL・nginx設定・PM2プロセスには触れない。

前提の確認結果（2026-08-05）:

| | |
|---|---|
| PostgreSQL | 未インストール（これから入れる） |
| Node | `/usr/bin/node` v22.22.2 がシステム全体にある。systemdから直接使える |
| カーネル | 6.8.0-111 稼働 / 6.8.0-136 導入済み。**再起動が必要** |
| PM2 | 7プロセス。`pm2-既存案件のユーザー.service` は enabled なので再起動後に自力で戻る |
| ドメイン | `yui-yamagata.com` 取得済み（XServer）。**DNS未設定** |

---

## 手順1: カーネル更新と再起動

**なぜ先にやるか。** 94日間、未適用のカーネルで動いている。この間に出た権限昇格系の
修正が効いていない。防災サイトを載せてから再起動すると、止める理由が増えて
先延ばしになる。載せる前に済ませる。

商用サイトが数分止まる。**アクセスの少ない時間帯に。**

```bash
# ── 再起動前の状態を控える（戻ったか比べるため）
pm2 save
pm2 list > /tmp/pm2-before.txt
systemctl list-units --type=service --state=running --no-legend | awk '{print $1}' | sort > /tmp/svc-before.txt
wc -l < /tmp/svc-before.txt

# ── 更新
sudo apt update
sudo apt upgrade -y
sudo reboot
```

再起動後（2〜3分待ってから接続し直す）:

```bash
uname -r                      # 6.8.0-136-generic になっていること
[ -f /var/run/reboot-required ] && echo "まだ必要" || echo "OK"

pm2 list                      # 7プロセスが online か
systemctl list-units --type=service --state=running --no-legend | awk '{print $1}' | sort > /tmp/svc-after.txt
diff /tmp/svc-before.txt /tmp/svc-after.txt && echo "サービスの欠落なし"
```

**商用サイトが戻ったことを必ず自分の目で確認する。**

```bash
for h in yukemuri-coffee.com smart-agri-vision.net geoalpine.net; do
  echo -n "$h "; curl -s -o /dev/null -w '%{http_code}\n' "https://$h/"
done
```

---

## 手順2: PostgreSQL + PostGIS

```bash
sudo apt install -y postgresql postgresql-contrib postgis postgresql-16-postgis-3
psql --version
```

同居前提でメモリを絞る。**既定値のままだと商用サイトのメモリを奪う。**

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '256MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '8MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 40;"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '1GB';"
sudo systemctl restart postgresql
free -h    # 空きが極端に減っていないこと
```

DBとロールを作る。パスワードは控えておく。

```bash
DBPASS=$(openssl rand -base64 24)
echo "DBパスワード: $DBPASS"     # ← 控える

sudo -u postgres psql <<SQL
CREATE ROLE yui LOGIN PASSWORD '$DBPASS';
CREATE DATABASE yui OWNER yui;
CREATE DATABASE yui_staging OWNER yui;
SQL

for db in yui yui_staging; do
  sudo -u postgres psql -d $db -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
done
```

---

## 手順3: デプロイ用ユーザー

**sudoグループには入れない。** 既存の `既存案件のデプロイ鍵` 鍵が
sudo可能な `既存案件のユーザー` に刺さっているのと同じ状態を繰り返さない（docs/deploy.md）。

```bash
sudo useradd -m -s /bin/bash deploy-yui
sudo mkdir -p /var/www/yui/{production,staging}
sudo chown -R deploy-yui:deploy-yui /var/www/yui

# 再起動だけを個別に許可する
sudo tee /etc/sudoers.d/deploy-yui >/dev/null <<'SUDO'
deploy-yui ALL=(root) NOPASSWD: /bin/systemctl restart yui, /bin/systemctl restart yui-staging, /bin/systemctl status yui, /bin/systemctl status yui-staging
SUDO
sudo chmod 440 /etc/sudoers.d/deploy-yui
sudo visudo -c        # 構文エラーがないこと
```

---

## 手順4: 秘密

**環境ごとに別の値にする。** 同じ `TOKEN_SECRET` を使うと、ステージングで
発行した管理cookieが本番でも通る。

```bash
sudo mkdir -p /etc/yui

sudo tee /etc/yui/production.env >/dev/null <<ENV
DATABASE_URL=postgresql://yui:${DBPASS}@localhost:5432/yui
TOKEN_SECRET=$(openssl rand -base64 48)
ADMIN_PASSWORD=$(openssl rand -base64 18)
PRODUCTION_URL=https://yui-yamagata.com
ENV

sudo tee /etc/yui/staging.env >/dev/null <<ENV
DATABASE_URL=postgresql://yui:${DBPASS}@localhost:5432/yui_staging
TOKEN_SECRET=$(openssl rand -base64 48)
ADMIN_PASSWORD=$(openssl rand -base64 18)
PRODUCTION_URL=https://yui-yamagata.com
ENV

sudo chown root:root /etc/yui/*.env
sudo chmod 600 /etc/yui/*.env

# 管理画面のパスワードを控える
sudo grep ADMIN_PASSWORD /etc/yui/production.env
```

`TOKEN_SECRET` を後から変えると、既存の匿名IDと管理セッションが全て無効になる。
むやみに回さない。

---

## 手順5: DNS

XServerのDNS管理でAレコードを追加する。

| ホスト | 種別 | 値 |
|---|---|---|
| `@` | A | `210.131.217.236` |
| `www` | A | `210.131.217.236` |
| `staging` | A | `210.131.217.236` |

**Cloudflareは後で入れる。** 先に証明書を取り、動くことを確かめてから前段に置く。
最初からCloudflare経由にすると、切り分けが難しくなる。

反映を待つ:

```bash
dig +short yui-yamagata.com A          # 210.131.217.236 が返るまで待つ
```

---

## 手順6: 配置とビルド

```bash
sudo -u deploy-yui -H bash
cd /var/www/yui/production
git clone https://github.com/geoAlpine/yui-yamagata.git current
cd current
npm ci
set -a; . /etc/yui/production.env; set +a     # ビルドにDBが要る
npm run build
exit
```

`next.config.ts` に `output: 'standalone'` を入れていない場合は、
`npm start` がそのまま使えるのでこのままでよい。

スキーマを流し、参照データを入れる:

```bash
sudo -u deploy-yui -H bash
cd /var/www/yui/production/current
set -a; . /etc/yui/production.env; set +a
for f in db/0*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
node --env-file=/etc/yui/production.env scripts/import_osm.mjs
node --env-file=/etc/yui/production.env scripts/assign_municipality.mjs   # 30分ほどかかる
node --env-file=/etc/yui/production.env scripts/import_water.mjs
exit
```

---

## 手順7: systemd

```bash
sudo cp /var/www/yui/production/current/deploy/yui.service /etc/systemd/system/
sudo cp /var/www/yui/production/current/deploy/yui-staging.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yui
sudo systemctl status yui --no-pager | head -8
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/     # 200
```

`MemoryMax=768M` / `CPUQuota=150%` が効いていること:

```bash
systemctl show yui -p MemoryMax -p CPUQuotaPerSecUSec
```

---

## 手順8: nginx と証明書

```bash
sudo cp /var/www/yui/production/current/deploy/nginx-production.conf /etc/nginx/sites-available/yui
sudo ln -sf /etc/nginx/sites-available/yui /etc/nginx/sites-enabled/

# 証明書を取る前は 443 のブロックが証明書を参照して落ちるので、
# 一旦 80 だけにして certbot に書かせる
sudo certbot --nginx -d yui-yamagata.com -d www.yui-yamagata.com

sudo nginx -t && sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' https://yui-yamagata.com/
```

**既存サイトを壊していないこと**を再確認:

```bash
for h in yukemuri-coffee.com smart-agri-vision.net geoalpine.net; do
  echo -n "$h "; curl -s -o /dev/null -w '%{http_code}\n' "https://$h/"
done
```

---

## 手順9: 確認

```bash
# 主要ページ
for p in / /notices /spots/new /admin; do
  echo -n "$p "; curl -s -o /dev/null -w '%{http_code}\n' "https://yui-yamagata.com$p"
done

# 本番として振る舞っているか（ステージングと取り違えていないか）
curl -s https://yui-yamagata.com/robots.txt          # Allow: / であること
curl -s https://yui-yamagata.com/ | grep -c envbar   # 0 であること

# 免責と出典
curl -s https://yui-yamagata.com/ | grep -c "住民の目撃情報です"
curl -s https://yui-yamagata.com/ | grep -c "OpenStreetMap contributors"
```

---

## 手順10: Cloudflare（動作確認が済んでから）

1. Cloudflareにドメインを追加し、XServerのNSからCloudflareのNSへ変更
2. **`set_real_ip_from` を最優先で入れる。**
   忘れると nginx のログのIPが全部Cloudflareのものになり、`fail2ban` と
   `auto-block-attackers.sh`（毎時cron）が**Cloudflareのアドレス帯をBANして
   サイトが全員から見えなくなる**
3. SSLを **Full (strict)** に（Flexibleはリダイレクトループになる）
4. Cache Rules でHTMLを30〜60秒キャッシュ

---

## 残す宿題

- バックアップの逃がし先（同じVPS内はバックアップにならない）
- ステージングの構築（docs/staging.md）
- 住民拠点SSのCSV投入（docs/../scripts/import_juminss.mjs）
