#!/bin/bash
# 実データの定期更新。VPSの cron から月1で叩く。
#
# 平時に誰も開かないサイトは、データも古くなる。
# 潰れた店が「営業中」の候補として並んだまま災害を迎えるのを避ける。
#
# spots は upsert なので、住民の報告（observations）は消えない。
set -uo pipefail

# ログは deploy-yui が書ける場所に置く。
# /var/log は root:syslog 775 で、deploy-yui はどちらのグループにも属さない。
# 当初 /var/log/yui に出そうとして mkdir に失敗し、cronが毎月静かに
# 落ち続ける状態になっていた（誰も気づかないので最悪の壊れ方）。
LOGDIR=/var/www/yui/production/logs
mkdir -p "$LOGDIR" || { echo "ログ出力先を作れません: $LOGDIR"; exit 1; }
LOG="$LOGDIR/refresh-$(date +%Y%m%d).log"
exec > >(tee -a "$LOG") 2>&1

# --check は疎通と権限だけ確かめて終わる。cronを1か月待たずに検証するため。
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1

echo "===== $(date -Is) データ更新 $([ $CHECK = 1 ] && echo '事前確認' || echo '開始') ====="
cd /var/www/yui/production/current
set -a; . /etc/yui/production.env; set +a

if [ $CHECK = 1 ]; then
  echo "ログ出力先: $LOG（書込可）"
  echo "DB接続: $(psql "$DATABASE_URL" -tAc 'select count(*) from spots') spots"
  echo "Overpass: $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://overpass-api.de/api/status)"
  echo "取り込みスクリプト:"
  for f in scripts/import_osm.mjs scripts/import_water.mjs scripts/assign_municipality.mjs; do
    [ -r "$f" ] && echo "  あり $f" || echo "  ★無い $f"
  done
  echo "===== 事前確認OK ====="
  exit 0
fi

before=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active")
echo "更新前: ${before} 件"

# 取り込みの失敗を必ず表に出す。
#
# 以前はここで終了コードを見ていなかった。Overpassが504を返して import_osm が
# 落ちても後続はそのまま走り、スポットは減っていないので下の2割減の判定も通り、
# 「完了」と表示して exit 0 で終わっていた。更新できた月とできなかった月が
# ログの上で見分けられない状態で、実際に本番で504を踏んだ。
#
# set -e は使わない。1本こけても残りと後片付けは走らせたうえで、
# 最後にまとめて失敗として返したい。
failed=""
run() {
  local label="$1"; shift
  echo "--- ${label}"
  "$@"
  local rc=$?
  [ $rc -eq 0 ] && return 0
  echo "★${label} に失敗しました（終了コード ${rc}）"
  failed="${failed}${label} "
  return $rc
}

run "OSMの取り込み" node --env-file=/etc/yui/production.env scripts/import_osm.mjs
run "応急給水拠点の取り込み" node --env-file=/etc/yui/production.env scripts/import_water.mjs

# 市町村の割り当ては Overpass のレート制限で30分ほどかかる。
# import_progress に記録が残っているので、新規スポットの分だけ処理される。
# ここが失敗すると次の行が全件を処理し直すため、消し込みも成否を見る。
run "市町村の進捗リセット" psql "$DATABASE_URL" -q -c "DELETE FROM import_progress WHERE key LIKE 'muni:%'"
run "市町村の割り当て" node --env-file=/etc/yui/production.env scripts/assign_municipality.mjs

after=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active")
nomuni=$(psql "$DATABASE_URL" -tAc "select count(*) from spots where is_active and municipality is null")
echo "更新後: ${after} 件 / 市町村未設定 ${nomuni} 件"

# 大きく減っていたら異常。取り込み元の障害を疑う
if [ "$after" -lt $(( before * 8 / 10 )) ]; then
  echo "★スポットが2割以上減りました（${before} → ${after}）。取り込み元を確認してください"
  exit 1
fi

# 古いログを片付ける
find "$LOGDIR" -name 'refresh-*.log' -mtime +90 -delete 2>/dev/null || true

# 「減っていないから正常」で終わらせない。
# 取り込みが空振りした月も件数は減らないので、上の判定では捕まらない。
if [ -n "$failed" ]; then
  echo "★失敗した処理があります: ${failed}"
  echo "  データは更新されていない可能性があります。ログを確認してください: ${LOG}"
  exit 1
fi

echo "===== $(date -Is) 完了 ====="
