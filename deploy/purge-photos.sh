#!/bin/bash
# 期限切れの写真を消す。cron から日次で叩く。
#
# 詳細ページに「14日で自動的に消えます」と書いている。利用者への約束であり、
# 実装がなければ嘘になる。写り込んだ人の顔が永久に残ることを意味する。
# 消すことは容量対策であると同時にプライバシー対策でもある。
#
# ── 以前ここにあった実装が動かなかった理由（同じ轍を踏まないため）──
#   1. UP="$ROOT/current/uploads" を見ていた
#      保存先は /var/www/yui-uploads/{env}/ に移してある（nginxが読めるように）。
#      存在しないディレクトリを find していたので1枚も消えなかった。
#   2. find -name '*.webp' だけだった
#      canvas が WebP を出せない端末（iOS）は JPEG になる。実機の写真は
#      ほぼ .jpg なので、いちばん消したいものが対象外だった。
#   3. 一覧用サムネイル（_t 付き）を知らなかった
#      原寸だけ消してサムネイルが残り、カードに写真が出続ける。
#   4. cron に登録されていなかった。そもそも一度も動いていない。
#
# 判定をシェルの find でやめ、DBを見る node に寄せた。
# 「どのファイルがまだ生きているか」を知っているのはDBだけで、
# mtime での近似はこの種の取りこぼしを生む。
set -uo pipefail

TARGET="${1:-production}"
case "$TARGET" in
  staging)    ROOT=/var/www/yui/staging ;;
  production) ROOT=/var/www/yui/production ;;
  *) echo "使い方: purge-photos.sh [staging|production] [--dry]"; exit 1 ;;
esac
shift || true

# ログは deploy-yui が書ける場所に置く。/var/log は root:syslog 775 で書けない
# （refresh-data.sh で一度踏んで、cronが静かに落ち続ける状態を作った）。
LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR" || { echo "ログ出力先を作れません: $LOGDIR"; exit 1; }
LOG="$LOGDIR/purge-$(date +%Y%m).log"
exec > >(tee -a "$LOG") 2>&1

echo "===== $(date -Is) 写真の削除 ($TARGET) ====="
cd "$ROOT/current" || exit 1
set -a; . "/etc/yui/${TARGET}.env"; set +a

# UPLOAD_DIR は環境ファイルから来る。設定漏れに気づかないまま
# process.cwd()/uploads を掃除しにいくと、何も消えないのに成功して見える。
if [ -z "${UPLOAD_DIR:-}" ]; then
  echo "UPLOAD_DIR が設定されていません。/etc/yui/${TARGET}.env を確認してください。"
  exit 1
fi
echo "保存先: $UPLOAD_DIR"

node scripts/purge_photos.mjs "$@"
rc=$?

# 古いログは畳む。ここが増え続けたら本末転倒
find "$LOGDIR" -name 'purge-*.log' -mtime +180 -delete 2>/dev/null || true

echo "===== $(date -Is) 終了 (rc=$rc) ====="
exit $rc
