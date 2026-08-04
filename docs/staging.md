# ステージング環境

## なぜ厳重に隠すのか

普通のWebサービスなら、ステージングが見えてしまっても「恥ずかしい」程度で済む。
このサイトは違う。

**災害情報サイトのステージングを被災者が見つけて信じると、実害が出る。**
「営業中」と表示されたテストデータの店に向かう、給水所があると思って行く。
停電と渋滞のなかでの無駄足は、体力と時間と、場合によっては安全を奪う。

そこで三重に止める。どれか一つが破れても残りが効くようにする。

| 層 | 手段 | 破れる条件 |
|---|---|---|
| アプリ | 紫の帯「動作確認用のサイトです / 情報は本物ではありません」＋本番への導線 | 帯を消す変更を入れたとき（CIで検知する） |
| アプリ | `robots.txt` と `<meta robots>` で noindex | 検索エンジンが従わないとき |
| nginx | Basic認証 | 認証情報が漏れたとき |
| nginx | `X-Robots-Tag: noindex` | — |

**帯とnoindexだけでは足りない。** URLを知られた時点で読まれてしまうので、
Basic認証を必ず掛ける。逆に、Basic認証だけでも足りない。認証を通った関係者が
本番と取り違える事故が起きるので、帯は必須。

---

## 構成

| | 本番 | ステージング |
|---|---|---|
| URL | `yui-yamagata.com` | `staging.yui-yamagata.com` |
| ポート | 3010 | 3011 |
| systemd | `yui.service` | `yui-staging.service` |
| DB | `yui` | `yui_staging` |
| 配置先 | `/var/www/yui/production` | `/var/www/yui/staging` |
| メモリ上限 | 768M | 384M |
| CPU上限 | 150% | 75% |
| Cloudflare | 通す | **通さない**（オリジン直・Basic認証） |

ステージングは本番より小さく縛る。**確認用が本番を圧迫してはいけない。**
同じVPSには商用サイトも同居しているので、上限は必ず付ける。

---

## データの扱い — 本番からコピーしない

ステージングのDBに**本番のデータをそのまま持ってこない**。

`observations` と `confirmations` には投稿者のIPと匿名IDが入っている。
これは投稿した住民のものであって、動作確認のために複製してよいものではない。

代わりに、参照データだけを取り込み直す。

```bash
# ステージングDBを作る
sudo -u postgres createdb yui_staging
psql "$STAGING_DB" -c "CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto;"
for f in db/0*.sql; do psql "$STAGING_DB" -v ON_ERROR_STOP=1 -f "$f"; done

# 参照データ（店舗・給水拠点）は本番と同じものを入れ直す
DATABASE_URL="$STAGING_DB" node scripts/import_osm.mjs
DATABASE_URL="$STAGING_DB" node scripts/assign_municipality.mjs
DATABASE_URL="$STAGING_DB" node scripts/import_water.mjs
```

住民の報告は空のまま始まる。確認したい状況は、ステージング上で自分で投稿して作る。

---

## 秘密は環境ごとに分ける

```
/etc/yui/production.env   (root:root 600)
/etc/yui/staging.env      (root:root 600)
```

**`TOKEN_SECRET` は本番とステージングで必ず別の値にする。**
同じ値を使うと、ステージングで発行した管理cookieが本番でも通ってしまう。

```bash
openssl rand -base64 48    # 環境ごとに別々に生成する
```

`ADMIN_PASSWORD` も分ける。ステージングのパスワードは共有されやすいので、
本番と同じにすると事実上公開したのと変わらなくなる。

---

## Basic認証の設定

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/yui-staging.htpasswd yui
sudo chown root:www-data /etc/nginx/yui-staging.htpasswd
sudo chmod 640 /etc/nginx/yui-staging.htpasswd
```

---

## 手順

```bash
# 1. 配置先とユーザー（docs/deploy.md 参照。sudoグループには入れない）
sudo mkdir -p /var/www/yui/{production,staging}
sudo chown -R deploy-yui:deploy-yui /var/www/yui

# 2. 設定を置く
sudo cp deploy/yui.service deploy/yui-staging.service /etc/systemd/system/
sudo cp deploy/nginx-staging.conf    /etc/nginx/sites-available/yui-staging
sudo cp deploy/nginx-production.conf /etc/nginx/sites-available/yui
sudo ln -sf /etc/nginx/sites-available/yui-staging /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/yui         /etc/nginx/sites-enabled/

# 3. 証明書
sudo certbot --nginx -d staging.yui-yamagata.com
sudo certbot --nginx -d yui-yamagata.com -d www.yui-yamagata.com

# 4. 起動
sudo systemctl daemon-reload
sudo systemctl enable --now yui-staging yui
sudo nginx -t && sudo systemctl reload nginx
```

---

## 確認すること

デプロイのたびに、**ステージングが本番の顔をしていないか**を見る。

```bash
curl -su yui:PASS https://staging.yui-yamagata.com/robots.txt
#   → Disallow: /   （Allow が返ったら事故。すぐ止める）

curl -su yui:PASS https://staging.yui-yamagata.com/ | grep -c envbar
#   → 1             （0なら帯が消えている）

curl -s https://staging.yui-yamagata.com/ -o /dev/null -w '%{http_code}\n'
#   → 401           （200ならBasic認証が外れている）
```

`robots.txt` は**実行時に評価される**ようにしてある（`app/robots.ts` の
`force-dynamic`）。これが無いとビルド時の環境が焼き付き、ステージングで
ビルドした成果物を本番に配ったときに**本番が検索結果から消える**。
しかも気づくのは数週間後になる。設定を変えるときは必ず上のcurlで確かめる。
