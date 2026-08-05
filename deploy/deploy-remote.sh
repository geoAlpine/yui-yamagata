#!/bin/bash
# 本番デプロイ。deploy-yui として実行される。
#
# GitHub Actions から SSH で叩かれる唯一の入口。authorized_keys の command= で
# これ以外は実行できないよう縛ってある（鍵が漏れてもシェルは取れない）。
#
# 災害情報サイトでは「常に最新」より「常に動く」が優先。
# ビルドが壊れていれば再起動せず、再起動後に応答しなければ前の版へ戻す。
set -uo pipefail

APP=/var/www/yui/production/current
PREV=/var/www/yui/production/previous
LOG=/tmp/yui-deploy.log

exec > >(tee "$LOG") 2>&1
echo "===== $(date -Is) デプロイ開始 ====="

export GIT_SSH_COMMAND="ssh -i /home/deploy-yui/.ssh/id_ed25519"
cd "$APP"
set -a; . /etc/yui/production.env; set +a

OLD=$(git rev-parse HEAD)
echo "現在: $OLD"

echo "--- 取得"
git fetch -q origin
NEW=$(git rev-parse origin/main)
if [ "$OLD" = "$NEW" ]; then echo "変更なし。終了"; exit 0; fi
git reset -q --hard origin/main
echo "更新: $(git log -1 --format='%h %s')"

echo "--- 動いている版を退避（切り戻し用）"
rm -rf "$PREV"; mkdir -p "$PREV"
[ -d .next ] && cp -a .next "$PREV/.next"

echo "--- 依存"
npm ci --silent

echo "--- マイグレーション（db/dev は対象外）"
for f in db/0*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" || { echo "★ $f で失敗"; exit 1; }
done

echo "--- ビルド"
rm -rf .next
if ! npm run build; then echo "★ビルド失敗。再起動しません"; exit 1; fi

# ディレクトリの有無ではなく、必要なファイルの実在を見る。
# 以前ここを [ -d .next ] にしていて、失敗ビルドを通して49回クラッシュさせた。
if [ ! -f .next/prerender-manifest.json ]; then
  echo "★成果物が不完全。再起動しません"; exit 1
fi

echo "--- 再起動"
sudo /bin/systemctl restart yui
sleep 8

echo "--- ヘルスチェック"
ok=0
for i in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3010/ || true)
  if [ "$code" = "200" ]; then ok=1; break; fi
  sleep 3
done

if [ "$ok" != "1" ]; then
  echo "★応答しません。前の版へ戻します"
  git reset -q --hard "$OLD"
  rm -rf .next
  [ -d "$PREV/.next" ] && cp -a "$PREV/.next" .next
  npm ci --silent
  sudo /bin/systemctl restart yui
  sleep 8
  back=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3010/ || true)
  echo "切り戻し後の応答: $back"
  exit 1
fi

echo "--- 確認"
for p in / /notices /spots/new /robots.txt; do
  echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3010$p)"
done
# 消えても動いてしまうものを、デプロイのたびに確かめる
html=$(curl -s --max-time 8 http://127.0.0.1:3010/)
echo "$html" | grep -q "住民の目撃情報です" || { echo "★免責が消えている"; exit 1; }
echo "$html" | grep -q "OpenStreetMap contributors" || { echo "★出典が消えている"; exit 1; }
echo "$html" | grep -q envbar && { echo "★本番に確認用の帯が出ている"; exit 1; }
curl -s --max-time 8 http://127.0.0.1:3010/robots.txt | grep -q "Allow: /" || { echo "★本番が索引不可になっている"; exit 1; }

echo "===== 完了: $(git log -1 --format='%h %s') ====="
