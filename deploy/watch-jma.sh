#!/bin/bash
# 気象庁の防災情報を確認し、災害モードを自動で切り替える。cron から毎分。
#
# 毎分なのは、震度速報が地震の約1分半後に出るため。
# 気象庁のフィードは cache-control: max-age=60 を返すので、
# 毎分の確認は想定どおり。ETag による条件付きGETで、
# 変化がなければ 304 で終わる（本文は落とさない）。
#
# ログは失敗と切替のときだけ残す。毎分の「変化なし」を書くと
# ログがそれで埋まり、肝心の記録が見えなくなる。
set -uo pipefail
TARGET="${1:-production}"
case "$TARGET" in
  staging)    ROOT=/var/www/yui/staging ;;
  production) ROOT=/var/www/yui/production ;;
  *) echo "使い方: watch-jma.sh [staging|production] [--dry]"; exit 1 ;;
esac
shift || true

cd "$ROOT/current" || exit 1
set -a; . "/etc/yui/${TARGET}.env"; set +a

LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR" || exit 1
LOG="$LOGDIR/jma-$(date +%Y%m).log"

out=$(node scripts/watch_jma.mjs "$@" 2>&1)
rc=$?

# 切替・通知・失敗があったときだけ記録する
if [ $rc -ne 0 ] || echo "$out" | grep -qE '★|通知のみ|失敗'; then
  { echo "===== $(date -Is) ($TARGET) rc=$rc"; echo "$out"; } >> "$LOG"
fi

find "$LOGDIR" -name 'jma-*.log' -mtime +365 -delete 2>/dev/null || true
exit $rc
