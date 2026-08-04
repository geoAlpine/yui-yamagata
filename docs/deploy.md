# デプロイの手順と、鍵の扱い

## 先に読む: デプロイ鍵を sudo ユーザーに刺さない

このVPSには既に `既存案件のデプロイ鍵` という鍵が `既存案件のユーザー` の
`authorized_keys` に入っている。そして `既存案件のユーザー` は `sudo` グループに属している。

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

## デプロイ前チェック

- [ ] カーネル更新と再起動を済ませた（TASKS.md D-1）
- [ ] PostgreSQL + PostGIS を導入し、`shared_buffers=256MB` 等に調整した
- [ ] `db/0*.sql` を順に流した
- [ ] `TOKEN_SECRET` / `ADMIN_PASSWORD` を本番値で設定した
- [ ] `deploy-yui` ユーザーを作り、sudo グループには**入れていない**
- [ ] `set_real_ip_from` を設定した
- [ ] バックアップの逃がし先を決めた（同じVPS内はバックアップにならない）
