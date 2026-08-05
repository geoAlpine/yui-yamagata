#!/bin/bash
# リハーサル用のシナリオをステージングに流す。
#
# ★本番では絶対に実行しない。DB名を検査して弾く。
#   架空の避難所や給水所が本番に載ると、被災者が実際に向かってしまう。
#   一度その事故（開発用シードの混入）を起こしているので、機械で止める。
#
#   flood  … 豪雨（令和6年7月豪雨の再現）。山形で最も現実的なシナリオ
#   reset  … シナリオを消して平時に戻す
set -uo pipefail

MODE="${1:-flood}"
ENVFILE=/etc/yui/staging.env
[ -r "$ENVFILE" ] || { echo "ステージングの設定が読めません: $ENVFILE"; exit 1; }
set -a; . "$ENVFILE"; set +a

# 二重の安全装置。DB名が yui_staging でなければ何もしない
DBNAME=$(psql "$DATABASE_URL" -tAc 'select current_database()')
if [ "$DBNAME" != "yui_staging" ]; then
  echo "★接続先が yui_staging ではありません（$DBNAME）。中止します。"
  exit 1
fi
echo "接続先: $DBNAME"

cd /var/www/yui/staging/current

case "$MODE" in
  flood)
    echo "=== 豪雨シナリオを流す ==="
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/dev/rehearsal_flood.sql
    ;;
  reset)
    echo "=== シナリオを消して平時に戻す ==="
    psql "$DATABASE_URL" -q -c "DELETE FROM notices WHERE owner_token='rehearsal';"
    psql "$DATABASE_URL" -q -c "DELETE FROM reports WHERE reporter_token='rehearsal';"
    psql "$DATABASE_URL" -q -c "DELETE FROM observations WHERE reporter_token IN ('rehearsal','r1','r2','r3');"
    psql "$DATABASE_URL" -q -c "DELETE FROM spots WHERE source='official' AND category IN ('supply','waste','road','lifeline');"
    psql "$DATABASE_URL" -q -c "UPDATE site_state SET mode='standby', notice=NULL WHERE id=true;"
    ;;
  *) echo "使い方: rehearse.sh [flood|reset]"; exit 1 ;;
esac

echo
echo "=== 状態 ==="
psql "$DATABASE_URL" -tAc "select '  モード: '||mode||coalesce(' / 告知あり','') from site_state"
psql "$DATABASE_URL" -tAc "select '  ' || category || ': ' || count(*) from spots where is_active group by category order by count(*) desc" | head -14
echo "  観測: $(psql "$DATABASE_URL" -tAc 'select count(*) from observations')"
echo "  お知らせ: $(psql "$DATABASE_URL" -tAc 'select count(*) from notices')"
echo "  未対応の通報: $(psql "$DATABASE_URL" -tAc 'select count(*) from reports where resolved_at is null')"
echo
echo "  https://staging.yui-yamagata.com/"
