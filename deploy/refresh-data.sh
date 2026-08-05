#!/bin/bash
# 実データの定期更新。VPSの cron から月1で叩く。
#
# 平時に誰も開かないサイトは、データも古くなる。
# 潰れた店が「営業中」の候補として並んだまま災害を迎えるのを避ける。
#
# spots は upsert なので、住民の報告（observations）は消えない。
set -uo pipefail
LOG=/var/log/yui/refresh-$(date +%Y%m%d).log
mkdir -p /var/log/yui
exec > >(tee -a "$LOG") 2>&1

echo "===== $(date -Is) データ更新 開始 ====="
cd /var/www/yui/production/current
set -a; . /etc/yui/production.env; set +a

before=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active")
echo "更新前: ${before} 件"

node --env-file=/etc/yui/production.env scripts/import_osm.mjs
node --env-file=/etc/yui/production.env scripts/import_water.mjs

# 市町村の割り当ては Overpass のレート制限で30分ほどかかる。
# import_progress に記録が残っているので、新規スポットの分だけ処理される。
psql "$DATABASE_URL" -q -c "DELETE FROM import_progress WHERE key LIKE 'muni:%'"
node --env-file=/etc/yui/production.env scripts/assign_municipality.mjs

after=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active")
nomuni=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active and municipality is null")
echo "更新後: ${after} 件 / 市町村未設定 ${nomuni} 件"

# 大きく減っていたら異常。取り込み元の障害を疑う
if [ "$after" -lt $(( before * 8 / 10 )) ]; then
  echo "★スポットが2割以上減りました（${before} → ${after}）。取り込み元を確認してください"
  exit 1
fi

# 古いログを片付ける
find /var/log/yui -name 'refresh-*.log' -mtime +90 -delete 2>/dev/null || true
echo "===== $(date -Is) 完了 ====="
