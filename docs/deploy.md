# デプロイの手順と、鍵の扱い

## 先に読む: デプロイ鍵を sudo ユーザーに刺さない

このVPSには既に、別案件のデプロイ用SSH鍵が入っている。
しかもその鍵の持ち主は `sudo` グループに属している。

つまり **GitHub の Secrets が漏れた時点で、sudo 可能なユーザーとしてシェルが取れる**。
既存サイトの構成なので今すぐ直せとは言わないが、**このプロジェクトでは繰り返さない**。

### 専用ユーザーを切る

```bash
# VPS側（sudo が要る）
sudo useradd -m -s /bin/bash deploy-yui
sudo mkdir -p /home/deploy-yui/.ssh && sudo chmod 700 /home/deploy-yui/.ssh
sudo chown -R deploy-yui:deploy-yui /home/deploy-yui/.ssh

# 配置先を deploy-yui が書けるようにする
sudo mkdir -p /var/www/yui
sudo chown deploy-yui:deploy-yui /var/www/yui
```

`deploy-yui` は **sudo グループに入れない**。サービスの再起動だけは必要なので、
そこだけを個別に許可する。

```
# /etc/sudoers.d/deploy-yui （visudo -f で編集）
deploy-yui ALL=(root) NOPASSWD: /bin/systemctl restart yui, /bin/systemctl status yui
```

これで、鍵が漏れても**このサービスの再起動しかできない**。

### 鍵にコマンド制限をかける

さらに絞るなら、`authorized_keys` 側で実行できるコマンドを固定する。

```
command="/usr/local/bin/deploy-yui.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-actions-yui
```

こうすると、その鍵で入っても `deploy-yui.sh` 以外は動かせない。

---

## 環境変数

**リポジトリに本番の値を置かない。** GitHub の Secrets とVPS側の環境ファイルに分ける。

| 変数 | 置き場所 | 備考 |
|---|---|---|
| `DATABASE_URL` | VPSの `/etc/yui/env`（root所有・600） | CIには渡さない |
| `TOKEN_SECRET` | 同上 | **未設定だと本番は起動時にエラーになる**（意図的） |
| `ADMIN_PASSWORD` | 同上 | |
| SSH秘密鍵 | GitHub Secrets | `deploy-yui` の鍵 |

`TOKEN_SECRET` は匿名IDと管理cookieの両方の署名鍵。生成例:

```bash
openssl rand -base64 48
```

**この値を変えると、既存の匿名IDと管理セッションが全て無効になる。**
利用者のお気に入り（端末内）は残るが、投稿者の同一性は切れる。むやみに回さない。

---

## systemd

既存サイトと同じ形に揃える（nginx + Node + systemd）。
リソース上限を必ず付ける。**防災サイトが暴走しても商用サイトを巻き込まないため。**

```ini
# /etc/systemd/system/yui.service
[Unit]
Description=やまがた結（ゆい）
After=network.target postgresql.service

[Service]
Type=simple
User=deploy-yui
WorkingDirectory=/var/www/yui/current
EnvironmentFile=/etc/yui/env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# 同居している商用サイトを守る（DESIGN.md 7章）
MemoryMax=768M
MemoryHigh=640M
CPUQuota=150%
TasksMax=256

# 最低限の隔離
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/yui

[Install]
WantedBy=multi-user.target
```

---

## Cloudflare の順番（守らないと事故る）

1. **`set_real_ip_from` を先に入れる。**
   これを忘れると nginx のログに残るIPが全部 Cloudflare のものになり、
   `fail2ban` と `auto-block-attackers.sh`（毎時cron）が
   **Cloudflare のアドレス帯をBANしてサイトが全員から見えなくなる**。
   レンジは https://www.cloudflare.com/ips-v4 から生成する（手打ちしない）。
2. SSL を **Full (strict)** にする。Flexible にするとリダイレクトループになる。
3. Cache Rules で HTML を 30〜60秒キャッシュする（既定ではキャッシュされない）。

---

## コードのデプロイだけでは完結しないもの

**自動デプロイ（`stg`/`main` への push）がやるのは、コードの反映とマイグレーションだけ。**
以下は別途、明示的に実行する。ステージング構築でこれを4回踏んだ。

| | 何が要るか | いつ必要か |
|---|---|---|
| **データ処理** | `import_shelters` / `fill_addresses` / `import_osm` / `import_water` | 取り込み対象を増やしたとき |
| **nginx 設定** | `apply-uploads.sh` 等で明示的に適用 | `location` を足す変更をしたとき |
| **ファイル配置** | 保存先ディレクトリの作成と所有者設定 | 新しい保存先を使うとき |
| **systemd unit** | `apply-unit.sh` で `ReadWritePaths` 等を反映 | unit を変更したとき |
| **cron** | `/etc/cron.d/` へ配置（immutable の解除が要る） | 定期処理を足したとき |

**自動デプロイが nginx と systemd を触らないのは意図的。**
CDがそれらを書き換えると、失敗したときに商用9サイトを巻き込む。
その代わり、アプリの機能追加がサーバ設定の変更を要求する場合、
そこが静かに抜ける。「デプロイしたのに動かない」という形で出る。

### 実際に踏んだ例: 写真機能

3段階で詰まった。掘るたびに原因が変わる。

1. **404** — nginx に `/uploads/` の設定が無く、Next.js が返していた
2. **403** — `/var/www/yui` が 750 で nginx（www-data）が通れない
   → 保存先を `/var/www/yui-uploads/{env}/` に出した
3. **500** — `ProtectSystem=strict` で書き込みが許可されていない
   → systemd の `ReadWritePaths` に追加

**3つ目はハードニングが正しく働いた結果。**
新しい場所に書くには明示的な許可が要る、という設計通りの挙動。

さらに **VPS側の作業はデプロイ完了を確認してから行う**。
`apply-unit.sh` は VPS上のリポジトリから unit を読むので、
デプロイ前に走らせると古い内容をコピーしてしまう。これも実際に踏んだ。

```bash
gh run list --repo geoAlpine/yui-yamagata --workflow Deploy --limit 1
# completed/success を確認してから実行する
```

## デプロイ前チェック

- [ ] カーネル更新と再起動を済ませた（TASKS.md D-1）
- [ ] PostgreSQL + PostGIS を導入し、`shared_buffers=256MB` 等に調整した
- [ ] `db/0*.sql` を順に流した
- [ ] `TOKEN_SECRET` / `ADMIN_PASSWORD` を本番値で設定した
- [ ] `deploy-yui` ユーザーを作り、sudo グループには**入れていない**
- [ ] `set_real_ip_from` を設定した
- [ ] バックアップの逃がし先を決めた（同じVPS内はバックアップにならない）
- [ ] 写真を消す cron を登録した（画面の「14日で消えます」は約束）

### 本番に写真機能を入れるとき

```bash
# デプロイ完了を確認してから、この順で
ssh -t vps sudo ./apply-uploads.sh production   # nginx に /uploads/
ssh -t vps sudo ./fix-uploads.sh production     # 保存先をツリー外へ
ssh -t vps sudo ./apply-unit.sh production      # ReadWritePaths
ssh -t vps sudo ./apply-purge-cron.sh           # 14日で消す cron
```

**最後の1つを飛ばすと、写真が永久に残る。**
詳細ページには「14日で自動的に消えます」と表示される。
利用者への約束なので、実装がなければ嘘になる。

`/etc/cron.d` には immutable 属性が付いている。手で置くなら:

```bash
chattr -i /etc/cron.d
install -o root -g root -m 644 deploy/yui-purge.cron /etc/cron.d/yui-purge
chattr +i /etc/cron.d
systemctl restart cron
```

cron は**書式が壊れているとファイル全体を黙って無視する**。
置いて終わりにせず、`purge-photos.sh <env> --dry` で実際に走ることを見る。

### 本番にデータを入れるとき

```bash
ssh -t vps sudo ./import-shelters.sh production  # 避難場所・避難所 3,876件
ssh -t vps sudo ./fill-addresses.sh production   # 住所（町名）約2,500件
```
