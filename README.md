# やまがた結（ゆい）

開いてる店・通れる道の今を、見た人が報告し合う山形の生活情報サイト。
平時は雪（除雪・路面）、有事は災害（営業中の店・ガソリン・給水・炊き出し）。

**名前について**: 「結（ゆい）」は農村の相互扶助の慣行。
住民同士が報告し合って支え合うという、このサイトの仕組みそのものを指す。
読みが割れる字なので、画面では常に「やまがた結（ゆい）」と読み仮名を添える
（災害時に口頭で伝わることが生命線のため）。

ドメイン: **`yui-yamagata.com`**（取得済み）

設計の全体像と判断の根拠は **[DESIGN.md](./DESIGN.md)** を参照。

現在: **Phase 0（MVP）実装中**

## 動かす

前提: Node 22+ / PostgreSQL 17+ with PostGIS（ローカルは Postgres.app）

```bash
# 1. DBを用意
createdb bousai
psql -d bousai -f db/001_schema.sql
for f in db/0*.sql; do psql -d bousai -f "$f"; done

# 開発用のダミーデータ（★本番には流さない。db/dev/README.md 参照）
psql -d bousai -f db/dev/002_seed_dev.sql
psql -d bousai -f db/dev/003_seed_observations_dev.sql

# 2. 接続先と鍵
cat > .env.local <<'ENV'
DATABASE_URL=postgresql://<user>@localhost:5432/bousai
TOKEN_SECRET=dev-only-insecure-secret   # 本番では十分に長いランダム文字列にする（必須）
ADMIN_PASSWORD=devpass                  # 管理画面 /admin のパスワード
ENV

# 3. 起動
npm install
npm run dev            # http://localhost:3000
```

### モードの切り替え

自動切替はしない（誤爆時の信頼失墜が回復不能なため）。DBを直接更新する。

```sql
UPDATE site_state SET mode = 'disaster';  -- 有事
UPDATE site_state SET mode = 'snow';      -- 平時
```

## 開発

```bash
npm run typecheck   # 型チェック
npm run lint        # ESLint
npm test            # 単体テスト（Node内蔵テストランナー + tsx）
npm run build
```

CI（`.github/workflows/ci.yml`）は上記に加えて、**PostGISを立ててマイグレーションを流し、
実際にページが200を返すところまで**確認する。ビルドが通るだけでは意味が薄いため。

さらに「免責の常時表示」と「OpenStreetMapの出典」が消えていないかも見ている。
どちらも消しても動いてしまうので、CIで固定しないと静かに失われる。

デプロイ手順と鍵の扱いは [docs/deploy.md](./docs/deploy.md)、
ステージングは [docs/staging.md](./docs/staging.md)。

### 環境の切り替え

同じビルド成果物を環境変数だけで切り替える。

```bash
npm start                    # 本番として動く（索引可・帯なし）
SITE_ENV=staging npm start   # 確認用として動く（noindex・紫の帯）
```

災害情報サイトのステージングは、被災者が見つけて信じると実害が出る。
帯・noindex・Basic認証の三重で止める（詳細は docs/staging.md）。

## 構成

```
app/
  page.tsx                  トップ（現在地から近い順のリスト。地図は既定にしない）
  spots/[id]/page.tsx       詳細（最新の状況＋観測履歴）
  spots/new/page.tsx        場所の追加（現在地から座標を取る。近隣重複を警告）
  report/[spotId]/page.tsx  報告（状態を選んで送信の2タップ）
  notices/                  お知らせ（ボランティア募集・物資の要望・支援）
  admin/page.tsx            管理（モード切替・通報キュー・お知らせの確認）
  api/spots/                GET=距離順で取り直す / POST=場所の追加
  api/observations/         観測の投稿
  api/confirmations/        「まだこの状況？」の1タップ
  api/notices/              お知らせの投稿（記名・連絡先必須）
  api/reports/              通報（管理キューに積むだけ。即時削除はしない）
  api/notices/close/        お知らせの終了報告（投稿者本人のみ）
lib/
  categories.ts   ★カテゴリ・状態・TTLの定義。ドメインの中心
  freshness.ts    ★鮮度の3段階判定
  identity.ts     ★署名付き匿名ID（HttpOnly cookie）。登録不要のまま詐称を防ぐ
  notices.ts       お知らせの種別と掲載のきまり
  admin.ts         管理者認証（パスワード1本の最小構成）
  queries.ts       SQL（spots に最新 observation を LATERAL で1件だけ結合）
db/
  001_schema.sql   spots ──< observations ──< confirmations
  004_notices.sql  notices（2つ目にして最後のプリミティブ）
```

### 中核となる3つの考え方

**1. 「投稿一覧」ではなく「場所に観測が積み重なる」**

同じ店に何人が報告しても1つのカードにまとまり、状況の推移が履歴として残る。
平時にスポットを登録しておけば、有事は「状態を選ぶだけ」で報告が終わる。

**2. 鮮度がすべて**

カテゴリごとにTTLを持つ（ガソリンの待ち時間120分／店舗営業360分／断水1440分）。
経過時間で3段階に減衰し、TTLを超えたら状態を「不明」に戻す。
判定は必ず `observed_at`（実際に見た時刻）で行い、`created_at`（投稿時刻）とは分ける。

**3. 登録は求めない。ただしIDは作らせない**

ユーザー登録なし。サーバがHMAC署名した匿名IDをHttpOnly cookieで配る。
localStorageのUUIDを信じると「100人が同意」を捏造できてしまうため。
プリミティブは2つだけ（spots←observations / notices）。3つ目は作らない。

## UI の方針

- **絵文字は使わない。** 端末ごとに描画が変わり、色もサイズも揃わないうえ、
  災害情報の画面では軽く見える。カテゴリは短い日本語のバッジ、
  下部タブは currentColor に従うインラインSVGで示す。
- **ダークテーマは持たない。** `color-scheme: light` を宣言し、
  端末がダークモードでも常に明るい画面を出す。
- 配色は全てWCAG AA（4.5:1）以上を実測で確認済み。

## 実データの取り込み

```bash
node --env-file=.env.local scripts/import_osm.mjs --dry   # 件数だけ確認
node --env-file=.env.local scripts/import_osm.mjs         # 取り込み
node --env-file=.env.local scripts/assign_municipality.mjs # 市町村を割り当て

# 住民拠点SS（停電時も給油できる自家発電付きスタンド）
#   資源エネルギー庁のページから最新の一覧(Excel)を落とし、
#   山形県の行だけを CSV で保存してから通す
node --env-file=.env.local scripts/import_juminss.mjs data/juminss_yamagata.csv --dry
```

現在の取り込み実績: **2,795件 / 市町村つき100%**（medical 1000・store 794・toilet 367・
cash 316・gas 283・laundry 26・charge 9）

**再実行は安全。** spots は `(osm_type, osm_id)` で upsert する。
消して作り直してはいけない（`observations` が `ON DELETE CASCADE` で連鎖削除され、
住民の報告が消える）。

`assign_municipality.mjs` は途中で止まっても続きから流せる。
Overpass の公開インスタンスは混雑時に 429/504 を返すため、一発で終わる前提に立たない。

### ライセンス

OpenStreetMap のデータは **ODbL 1.0**。出典表示が必要なので、
トップページ脚注の「© OpenStreetMap contributors」を消さないこと。

### 取り込まないもの

`amenity=drinking_water`（常設の水飲み場）は取り込まない。
断水すれば水飲み場も止まるため、「給水所」として出すとかえって誤解を招く。
給水所は自治体の応急給水拠点と利用者の報告に任せる。

### 取り込みで踏んだ落とし穴

- **再開判定を「その市町村のスポットが既にあるか」にしてはいけない。**
  OSMの `addr:city` が付いていた分だけで処理済みに見え、山形市・鶴岡市など
  大きな市がまるごと飛ばされる。`import_progress` に処理そのものを記録する。
- **OSMの給油所名はブランド名だけのことが多い**（「エネオス」80件・「JA」30件）。
  283件中240件が同名なので、住民拠点SSの名寄せは名前だけでは決まらない。
  国土地理院の住所検索で座標を出して最寄りに当てている。
- **国土地理院の住所検索は、解決できない住所に市区町村の代表点を黙って返す。**
  `title` が「山形県山形市」のように市レベルで止まっていたら捨てる。
  捨てないと無関係な給油所が「自家発電あり」と表示され、停電時に人を無駄足させる。

## 未実装（Phase 0 の残り）

- 写真投稿
- 応急給水拠点（`water`）・物資配布（`supply`）・災害ごみ仮置場（`waste`）の
  データ源。いずれもOSMには無く、自治体が災害時に発表するもの。
  現状は0件で、利用者の報告と自治体からの登録に依存する。

シードデータの座標は**概算の仮データ**であり、実在店舗の正確な位置ではない。
