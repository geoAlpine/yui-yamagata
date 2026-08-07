#!/bin/bash
# origin への直アクセスを塞ぐ。Cloudflare を経由した要求だけを通す。
#
#   sudo ./apply-origin-lockdown.sh          # 適用
#   sudo ./apply-origin-lockdown.sh --undo   # 元に戻す
#
# ── なぜ要るか ──
# CDNにHTMLとAPIを載せても、origin のIPを知っていれば迂回できる。
# しかも 210.131.217.236 は SPF レコード（v=spf1 ip4:...）で公開されており、
# dig 一発で分かる。負荷試験では /report が 115 req/s で飽和した。
# 家庭回線1本で届く数字で、商用サイトが同居している以上これは看過できない。
#
# ── なぜ firewall ではなく nginx なのか ──
# 443 は商用9サイトと共有している。**ufw で 443 を Cloudflare 限定にすると
# 他サイトが全部死ぬ。** サイト単位でしか絞れない。
#
# ── なぜ server ではなく location / なのか ──
# server 全体に掛けると、証明書更新（certbot --nginx が一時的に差し込む
# /.well-known/acme-challenge/）や /uploads/ まで巻き込む。
# 守りたいのはアプリ（Next.js に流れる動的な経路）なので、そこだけに絞る。
# 静的ファイルは nginx が直接返すので、そもそも負荷が桁違いに軽い。
#
# ── 判定に使う変数 ──
# $realip_remote_addr は、realip モジュールが書き換える**前**の接続元。
# $remote_addr は CF-Connecting-IP に置き換わっているので使ってはいけない
# （偽装ヘッダを付けるだけで素通しになる）。
set -uo pipefail

[ "$(id -u)" = "0" ] || { echo "sudo で実行してください"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
BK=/root/origin-lockdown-backup-$STAMP
GEO=/etc/nginx/conf.d/01-cloudflare-only.conf
SITE=/etc/nginx/sites-available/yui
MARK='# >>> origin-lockdown'

mkdir -p "$BK"

if [ "${1:-}" = "--undo" ]; then
  echo "=== 元に戻します ==="
  [ -f "$SITE" ] && cp -a "$SITE" "$BK/"
  sed -i "/$MARK/,/# <<< origin-lockdown/d" "$SITE"
  rm -f "$GEO"
  nginx -t 2>&1 | sed 's/^/  /'
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "  戻しました（backup: $BK）"
  exit 0
fi

echo "=== 1. Cloudflare のIP範囲を取得 ==="
V4=$(curl -sf --max-time 30 https://www.cloudflare.com/ips-v4) || { echo "取得失敗"; exit 1; }
V6=$(curl -sf --max-time 30 https://www.cloudflare.com/ips-v6) || { echo "取得失敗"; exit 1; }
N=$(printf '%s\n%s\n' "$V4" "$V6" | grep -c .)
[ "$N" -ge 20 ] || { echo "範囲が少なすぎます（$N）。取得内容を疑ってください"; exit 1; }
echo "  $N 範囲"

echo "=== 2. 判定用の geo ブロックを作成 ==="
[ -f "$GEO" ] && cp -a "$GEO" "$BK/"
{
  echo "# 自動生成: $(date -Is)"
  echo "# Cloudflare を経由した要求かどうかを判定する。"
  echo "# 範囲は https://www.cloudflare.com/ips-v4 から取得（手打ちしない）"
  echo "#"
  echo "# realip で書き換わる前の接続元を見る。\$remote_addr は"
  echo "# CF-Connecting-IP に置き換わっているので使ってはいけない。"
  echo "geo \$realip_remote_addr \$yui_via_cloudflare {"
  echo "    default 0;"
  echo "    127.0.0.1/32 1;   # ローカルからの疎通確認"
  echo "    ::1/128 1;"
  printf '%s\n' "$V4" | grep . | sed 's/^/    /; s/$/ 1;/'
  printf '%s\n' "$V6" | grep . | sed 's/^/    /; s/$/ 1;/'
  echo "}"
} > "$GEO"
echo "  $GEO を作成"

echo "=== 3. 防災サイトの location / に判定を差し込む ==="
cp -a "$SITE" "$BK/"
if grep -q "$MARK" "$SITE"; then
  echo "  既に入っています。何もしません"
else
  # yui-yamagata.com の server ブロック内の "location / {" の直後に入れる。
  # staging は別ファイル（sites-available/yui-staging）なので巻き込まない。
  awk -v mark="$MARK" '
    /location \/ \{/ && !done {
      print
      print "        " mark
      print "        # Cloudflare を経由しない直アクセスを拒否する。"
      print "        # CDNに載せても、origin のIPを知られていれば迂回できるため。"
      print "        # 静的ファイルと ACME チャレンジは対象外（location が別）。"
      print "        if ($yui_via_cloudflare = 0) { return 403; }"
      print "        # <<< origin-lockdown"
      done = 1
      next
    }
    { print }
  ' "$SITE" > "$SITE.new" && mv "$SITE.new" "$SITE"
  echo "  差し込みました"
fi

echo "=== 4. 検証して反映 ==="
if nginx -t 2>&1 | grep -q successful; then
  echo "  nginx -t: OK"
  systemctl reload nginx
  echo "  reload しました"
else
  echo "  ★nginx -t 失敗。元に戻します（他サイトは無傷）"
  nginx -t 2>&1 | sed 's/^/    /'
  cp -a "$BK/yui" "$SITE" 2>/dev/null
  rm -f "$GEO"
  exit 1
fi

echo
echo "=== 5. 確認 ==="
sleep 2
DIRECT=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -k -H 'Host: yui-yamagata.com' https://127.0.0.1/ || echo 000)
VIACF=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://yui-yamagata.com/ || echo 000)
echo "  直アクセス（Host偽装）      : $DIRECT   ← 403 が正常"
echo "  Cloudflare 経由             : $VIACF   ← 200 が正常"
echo
echo "backup: $BK"
echo "戻すには: sudo $0 --undo"
[ "$VIACF" = "200" ] || { echo "★Cloudflare 経由が 200 ではありません。すぐ --undo してください"; exit 1; }
