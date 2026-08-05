#!/bin/bash
# 期限切れの写真を消す。cron から日次で叩く。
#
# 2時間で腐る情報に付いた写真は、翌日には価値がない。
# 放置すると容量が際限なく増えるうえ、写り込んだ人の顔が残り続ける。
# 消すことが容量対策であると同時にプライバシー対策でもある。
set -uo pipefail
TARGET="${1:-production}"
case "$TARGET" in
  staging)    ROOT=/var/www/yui/staging ;;
  production) ROOT=/var/www/yui/production ;;
  *) echo "使い方: purge-photos.sh [staging|production]"; exit 1 ;;
esac
DAYS=14
UP="$ROOT/current/uploads"

set -a; . "/etc/yui/${TARGET}.env"; set +a
cd "$ROOT/current"

before=$(psql "$DATABASE_URL" -tAc "select count(*) from observations where photo_path is not null")
echo "$(date -Is) 削除前: ${before} 件"

# DBを先に消す。ファイルだけ残るのは無害だが、逆は「読めない写真」を出す
psql "$DATABASE_URL" -q -c "
  UPDATE observations SET photo_path = NULL, photo_bytes = NULL
  WHERE photo_path IS NOT NULL AND created_at < now() - interval '${DAYS} days'"

# ファイル本体
[ -d "$UP" ] && find "$UP" -type f -name '*.webp' -mtime +${DAYS} -delete 2>/dev/null
[ -d "$UP" ] && find "$UP" -type d -empty -delete 2>/dev/null

after=$(psql "$DATABASE_URL" -tAc "select count(*) from observations where photo_path is not null")
size=$([ -d "$UP" ] && du -sh "$UP" 2>/dev/null | cut -f1 || echo 0)
echo "$(date -Is) 削除後: ${after} 件 / 使用量: ${size}"
