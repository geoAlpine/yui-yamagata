# Cloudflare の導入手順

**順番を守ること。** 入れ替えると、サイトが全員から見えなくなる。

## なぜ入れるのか

熊本地震のイマココナビは7万人/日を捌いた。同規模が来たとき、
単一VPSでは持たない。しかもこのVPSには商用サイトが同居しているので、
**防災サイトの負荷が他サイトを巻き込む。**

CDNを前段に置き、HTMLを数十秒キャッシュすれば、origin に届くのは
1URLあたり数十秒に1回になる。

## 手順1: サーバ側（Cloudflare を有効にする「前」に必ず）

```bash
sudo ./apply-cloudflare-realip.sh
```

### これを飛ばすと何が起きるか

Cloudflare を通すと、全アクセスが十数個の Cloudflare IP から来る。
サーバから見ると「同じIPが大量にアクセスしている」状態になる。

1. **`/usr/local/bin/auto-block-attackers.sh`（毎時root）が Cloudflare を遮断する。**
   このスクリプトは access.log の1列目を見て、10回以上エラーを出したIPを
   `ufw deny` と `iptables -j DROP` で遮断する。
   Cloudflare のIPが遮断されると、**同居する商用サイトを含めて全員から見えなくなる。**
2. **レート制限が利用者単位でなくなる。**
   `limit_req_zone $binary_remote_addr` が Cloudflare のエッジ単位になり、
   10r/s を全利用者で共有する。混雑時に全員が 429。
3. fail2ban も同じ理由で誤爆する。

`set_real_ip_from` を入れると、nginx が `CF-Connecting-IP` を見て
`$remote_addr` を本当の利用者のIPに差し替える。上の3つが正しく動く。

この設定は http ブロック（全12サイト）に効くが、Cloudflare を通らない
サイトのリクエストは Cloudflare のIPから来ないため何も変わらない。共存できる。

**アドレス帯は手打ちしない。** https://www.cloudflare.com/ips-v4 から生成する。
範囲は変わる。スクリプトが取得して `/etc/nginx/cloudflare-ips.txt` に置く。

## 手順2: Cloudflare にドメインを追加

1. https://dash.cloudflare.com でアカウント作成（Free プランで足りる）
2. `yui-yamagata.com` を追加
3. DNSレコードを確認する。移すのは3つだけ（**MXは無いのでメールへの影響なし**）

| 種別 | 名前 | 値 | プロキシ |
|---|---|---|---|
| A | `@` | `210.131.217.236` | **オレンジ（有効）** |
| A | `www` | `210.131.217.236` | **オレンジ（有効）** |
| A | `staging` | `210.131.217.236` | **グレー（無効）** |

`staging` をグレーにするのは、確認用サイトをキャッシュさせないため。
Basic認証は Cloudflare 経由でも動くが、リスクを増やす理由がない。

## 手順3: ネームサーバーを変更

Xserver のドメインパネルで、Cloudflare が指定する2つに変更する。
現在は `ns1〜ns3.xdomain.ne.jp`。

反映に数十分〜48時間かかる。**この間サイトは止まらない**（旧NSも生きている）。

## 手順4: SSL を Full (strict)

**必ず Full (strict) にする。Flexible にするとリダイレクトループでサイトが開かなくなる。**

origin に Let's Encrypt が入っているので Full (strict) で問題なく動く。

## 手順5: キャッシュルール

### トップページは origin が `no-store` を返す

`app/page.tsx` は `searchParams`（`?cat=` `?muni=` `?hz=` `?q=`）で
絞り込む作りなので、Next.js が動的レンダリングと判定する。
JSが無くても絞り込めるようにするための設計で、これは正しい。

その結果 `cache-control: private, no-cache, no-store` が返る。
**このままでは Cloudflare が1件もキャッシュしないので、CDNを入れた意味がない。**

Cache Rules の **Edge TTL を「Override origin」** にして上書きする。
安全性は確認済み:

- **Set-Cookie を返さない。** 匿名IDは書き込み時のAPI応答でのみ発行する
  （`lib/identity.ts` に明記。CDNを想定した設計）
- **HTMLが利用者に依存しない。** 同一URLを2回取得して差分は `serverNow`
  （時刻）のみ。自宅の登録は端末内、現在地はクライアント側で処理する

### ルール0（最優先）: 「近い順」の取り直しだけはキャッシュする

`GET /api/spots` は、位置情報を許可した人が一覧を開くたびに呼ばれる。
HTMLをCDNに載せたあと、**CDNを通らない読み取りとしてはここが最大**になった。
同居する商用サイトを巻き込まないためにも落としておきたい。

下の**ルール1より上**に置くこと。順に評価され、最初に当たったものが効く。

```
（すべて満たす）
  URI Path equals "/api/spots"
  Request Method equals "GET"
    Cache eligibility : Eligible for cache
    Edge TTL          : Respect origin TTL   ← Override にしない
    Cache key         : クエリ文字列を含める（既定のまま）
```

Edge TTL を **Respect origin** にするのが要点。アプリ側が
`s-maxage=30, stale-while-revalidate=120` を返しており
（`app/api/spots/route.ts`）、どれだけ持ってよいかを知っているのは
CDNの設定画面ではなくアプリのほうだから。

載せてよい根拠:

- **返すのは公開情報だけ。** 利用者ごとに変わる要素がない
- **Set-Cookie を返さない。** 匿名IDの発行は POST 側のみ（`lib/identity.ts`）
- 呼び出し側が**座標を約100mに丸めて**送る（`components/SpotList.tsx`）。
  丸めないとURLが利用者ごとに別物になり、1件もヒットしない

**`POST /api/spots`（場所の追加）を巻き込まないこと。** Method の条件を
落とすと、匿名IDを発行する応答がキャッシュされ、他人のIDが配られる。

#### スクリプトで入れる

画面で作ってもよいが、`scripts/cloudflare_cache_rules.mjs` でも入れられる。
条件式や TTL を手で入力し直さずに済むので、こちらを勧める。

```bash
export CLOUDFLARE_API_TOKEN=...          # 作り方はスクリプト冒頭のコメント
node scripts/cloudflare_cache_rules.mjs           # 下見（既定）
node scripts/cloudflare_cache_rules.mjs --apply   # 反映
```

**ルールセット全体を PUT で置き換えない。** 一手で `/admin` と `/mine` の
Bypass を消せてしまい、管理画面や投稿者ごとの一覧がキャッシュされて
他人の情報が配られる。スクリプトは1件だけ追加する API を使い、
実行の前後で両方の Bypass が残っていることを確認して、消えていれば
異常終了する。既に入っている場合は二重に足さない。

### ルール1: キャッシュしない

以下は**利用者ごとに内容が異なる**。キャッシュすると他人の情報が配られる。

```
URI Path starts with "/api/"     → Bypass cache
URI Path starts with "/admin"    → Bypass cache
URI Path equals   "/mine"        → Bypass cache
```

`/mine` は `getOrIssueIdentity()` で投稿者ごとの一覧を出す。
`/admin` は管理セッションを見る。**この2つを外すと事故になる。**

`/api/` の Bypass はこのまま残す。ルール0が先に当たるので
`GET /api/spots` だけが抜け、書き込み系は従来どおり素通しになる。

### ルール2: HTMLをキャッシュする

```
（ルール1に当たらないもの全て）
  Cache eligibility : Eligible for cache
  Edge TTL          : Override origin → 30 秒
  Browser TTL       : Override origin → 0 秒
  Cache key         : クエリ文字列を含める（既定のまま）
```

30秒にしているのは、カテゴリの情報が数時間で腐る設計に対して
無視できる遅れであり、かつ origin への到達を 1/100 以下にできるため。

#### Edge TTL は Override ではなく Respect origin にしておくこと

本番の応答を実測すると、`/` は `EXPIRED`（＝キャッシュ対象）、
`/report` は `BYPASS` だった。`/report` は origin が `no-store` を返していたので、
**このルールは Override ではなく Respect origin で動いている**とみられる。

そちらが正しい。どのページをどれだけ持ってよいかを知っているのはアプリで、
`next.config.ts` が宣言している。Override にすると、`no-store` を返すべき
ページまで一律にキャッシュされ、`/mine` や `/admin` の Bypass を1つ外した
だけで事故になる。**Respect origin なら、アプリ側の宣言が最後の砦として残る。**

この結果、`/report` と `/report/:spotId` は**ダッシュボードを触らずに**
キャッシュされるようになる（アプリ側でヘッダを付けたため）。
デプロイ後に `cf-cache-status` が `HIT` になることで確認できる。

### Always Online

**オリジンが落ちても、Cloudflare が保持している版を配り続ける。**
無料プランで使える。災害サイトでは効果が大きい。

```
Caching → Configuration → Always Online : On
```

サーバが停止しても「避難所と給水拠点の位置は見られる」状態が残る。
報告の投稿はできなくなるが、**最後まで残すべきなのは位置情報のほう**。

`serverNow` が最大30秒古くなるが、`SpotCard` はマウント後に
クライアントの時計へ切り替えるので、初回描画の一瞬だけの話。

### 写真（`/uploads/`）

origin が `cache-control: public, max-age=604800` を返し、
拡張子も Cloudflare の既定キャッシュ対象なので**ルール不要**。

## 手順6: 切ってはいけない／入れてはいけない設定

| 設定 | 値 | 理由 |
|---|---|---|
| **Bot Fight Mode** | **オフ** | JSチャレンジを挟む。災害時に古い端末や省データモードで弾かれる |
| **Rocket Loader** | **オフ** | JSの読み込み順を変える。Reactのハイドレーションが壊れる |
| **Under Attack Mode** | **使わない** | 全員にチャレンジを出す。災害時には実質的な遮断 |
| **Always Use HTTPS** | オン | 問題ない |
| **Brotli** | オン | 転送量が減る |

**災害時に「人間であることを証明させる」機能は入れない。**
弾かれた人は避難情報に辿り着けない。

## 手順7: 確認

```bash
# Cloudflare を通っているか
curl -sI https://yui-yamagata.com | grep -i "^cf-\|^server"
#   server: cloudflare
#   cf-cache-status: HIT ← 2回目以降

# 実IPが復元されているか（ログの1列目が Cloudflare のIPでないこと）
sudo tail -3 /var/log/nginx/access.log

# Cloudflare が遮断されていないか
sudo ufw status | grep -c 104.  # 0 であるべき
```

`cf-cache-status: DYNAMIC` のままなら、キャッシュルールが効いていない。
Edge TTL の「Override origin」を確認する（origin が `no-store` を返すため、
`Respect origin` では絶対にキャッシュされない）。

## 通知メールのための SPF

災害モードの自動切替は `info@geoalpine.net` へメールで知らせる
（`scripts/watch_jma.mjs`）。差出人は `noreply@yui-yamagata.com` を名乗る。

**このままだと SPF 不一致で弾かれる。** Cloudflare の DNS に TXT を1件足す。

| 種別 | 名前 | 内容 | プロキシ |
|---|---|---|---|
| TXT | `@` | `v=spf1 ip4:210.131.217.236 -all` | （TXTに設定なし） |

`-all` は「ここに書いたIP以外からの yui-yamagata.com 名義のメールは
受け取るな」という意味。このドメインからメールを出すのはこのサーバだけなので、
厳しくしてよい。将来メール配信サービスを使うなら、そのIPを足す。

### 届くところまで確かめる

**災害時にしか送らないメールは、届かないことに気づく機会がない。**
差出人・件名の符号化・SPF・迷惑メール判定のどれが原因でも、
気づくのは災害の当日になる。

```bash
sudo -u deploy-yui /var/www/yui/production/current/deploy/watch-jma.sh production --test-mail
```

実際に届いたか、迷惑メールフォルダに入っていないかまで見る。
**年に一度は通しておく**（`docs/disaster-runbook.md` のリハーサルに含める）。

### 過去に踏んだこと

件名に日本語をそのまま渡すと postfix が SMTPUTF8 を要求し、
対応していない受信側（さくら等）で bounce する。

```
status=bounced (SMTPUTF8 is required, but was not offered by host ...)
```

件名は RFC 2047 の Base64 に符号化する。`mail -s "日本語"` で
手軽に送ると、この形で落ちる。

## 元に戻す

```bash
# nginx 側
sudo rm /etc/nginx/conf.d/00-cloudflare-realip.conf
sudo cp /root/cloudflare-backup-<日時>/auto-block-attackers.sh /usr/local/bin/
sudo nginx -t && sudo systemctl reload nginx
```

Cloudflare 側は、DNSレコードのプロキシをグレーに戻せば素通しになる。
ネームサーバーを Xserver に戻す必要はない。

## 残る課題

- **origin のIPが露出したままになる。** Cloudflare を迂回して直接叩かれうる。
  本来は firewall で Cloudflare のIPだけ許可するが、**同居する商用サイトは
  Cloudflare を通っていないので、そのままでは巻き込む。**
  やるなら 443 を Cloudflare 限定にはできず、サイト単位の対策が必要。
- Let's Encrypt の更新は Cloudflare 経由でも通る（`/.well-known/` を
  キャッシュルールで塞がないこと）。
