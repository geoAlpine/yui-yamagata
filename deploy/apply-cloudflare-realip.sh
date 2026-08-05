#!/bin/bash
# Cloudflare を入れる「前」に必ず実行する。
#
# ── これを飛ばすと何が起きるか ──
# Cloudflare を有効にすると、全アクセスが十数個の Cloudflare IP から来る。
# サーバから見ると「同じIPが大量にアクセスしている」状態になり、
#
#   1. /usr/local/bin/auto-block-attackers.sh（毎時root）が
#      Cloudflare のIPを ufw と iptables で遮断する。
#      → 同居する商用サイトを含め、全員からサイトが見えなくなる
#   2. limit_req_zone $binary_remote_addr が利用者ごとではなく
#      Cloudflare のエッジごとの制限になる。
#      → 10r/s を全利用者で共有し、混雑時に全員が 429
#   3. fail2ban も同じ理由で誤爆する
#
# set_real_ip_from を入れると、nginx が CF-Connecting-IP ヘッダを見て
# $remote_addr を本当の利用者のIPに差し替える。上の3つが正しく動くようになる。
#
# ※ この設定は http ブロック（全12サイト）に効くが、
#   Cloudflare を通らないサイトのリクエストは Cloudflare のIPから来ないため、
#   何も変わらない。安全に共存できる。
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "sudo で実行してください"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
BK=/root/cloudflare-backup-$STAMP
mkdir -p "$BK"

echo "=== 1. Cloudflare のIP範囲を取得 ==="
# 手打ちしない。範囲は変わる
V4=$(curl -sf --max-time 30 https://www.cloudflare.com/ips-v4) || { echo "取得失敗"; exit 1; }
V6=$(curl -sf --max-time 30 https://www.cloudflare.com/ips-v6) || { echo "取得失敗"; exit 1; }
n4=$(echo "$V4" | grep -c .); n6=$(echo "$V6" | grep -c .)
[ "$n4" -ge 5 ] || { echo "IPv4の範囲が少なすぎる($n4)。取得内容を疑う"; exit 1; }
echo "  IPv4 $n4 範囲 / IPv6 $n6 範囲"

# 他のスクリプトからも参照できるよう、生の一覧を残す
printf '%s\n%s\n' "$V4" "$V6" | grep . > /etc/nginx/cloudflare-ips.txt
chmod 644 /etc/nginx/cloudflare-ips.txt

echo
echo "=== 2. nginx に set_real_ip_from を設定 ==="
CONF=/etc/nginx/conf.d/00-cloudflare-realip.conf
[ -f "$CONF" ] && cp -a "$CONF" "$BK/"
{
  echo "# Cloudflare の実IP復元。$STAMP に自動生成"
  echo "# 範囲は https://www.cloudflare.com/ips-v4 から取得（手打ちしない）"
  echo "# 再生成: sudo ./apply-cloudflare-realip.sh"
  echo
  echo "$V4" | grep . | sed 's/^/set_real_ip_from /; s/$/;/'
  echo "$V6" | grep . | sed 's/^/set_real_ip_from /; s/$/;/'
  echo
  echo "real_ip_header CF-Connecting-IP;"
} > "$CONF"
echo "  $CONF を作成（$(grep -c set_real_ip_from "$CONF") 範囲）"

echo
echo "=== 3. 自動BANスクリプトが Cloudflare を遮断しないようにする ==="
AB=/usr/local/bin/auto-block-attackers.sh
cp -a "$AB" "$BK/"
echo "  退避: $BK/auto-block-attackers.sh"

if grep -q "cloudflare-ips.txt" "$AB"; then
  echo "  既に対策済み"
else
  # ホワイトリスト判定の直後に、CIDR での除外を挟む。
  # 元の文字列一致（grep -q）では CIDR を書いても効かないため、
  # python3 の ipaddress で正しく判定する。
  python3 - "$AB" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
anchor = """    # 既にブロック済みかチェック"""
guard = """    # Cloudflare の範囲は絶対に遮断しない。
    # 遮断すると、このサーバの全サイトが全利用者から見えなくなる。
    # set_real_ip_from が効いていればここに Cloudflare のIPは来ないが、
    # 設定が外れたときの最後の歯止めとして残す。
    if [ -f /etc/nginx/cloudflare-ips.txt ] && \\
       python3 -c "
import ipaddress,sys
ip=ipaddress.ip_address('$ip')
for line in open('/etc/nginx/cloudflare-ips.txt'):
    line=line.strip()
    if line and ip in ipaddress.ip_network(line):
        sys.exit(0)
sys.exit(1)" 2>/dev/null; then
        echo \"Skipped (Cloudflare): $ip\" >> $LOG
        continue
    fi

    # 既にブロック済みかチェック"""
assert anchor in s, "差し込み位置が見つからない"
open(p, 'w', encoding='utf-8').write(s.replace(anchor, guard, 1))
print("  Cloudflare 除外を追加")
PY
  bash -n "$AB" || { echo "  ★構文エラー。元に戻します"; cp -a "$BK/auto-block-attackers.sh" "$AB"; exit 1; }
  echo "  構文確認OK"
fi

echo
echo "=== 4. nginx の検証と反映 ==="
if nginx -t 2>&1 | grep -q "successful"; then
  echo "  nginx -t: OK"
  systemctl reload nginx
  echo "  reload 完了"
else
  echo "  ★nginx -t 失敗。reload せずに中止します（他サイトは無傷）"
  nginx -t 2>&1 | sed 's/^/    /'
  rm -f "$CONF"
  exit 1
fi

echo
echo "=== 5. 確認 ==="
echo "  設定ファイル: $(grep -c set_real_ip_from "$CONF") 範囲"
echo "  real_ip_header: $(grep real_ip_header "$CONF" | tr -d ';')"
echo "  同居サイトの疎通:"
for h in yui-yamagata.com; do
  echo "    $h: $(curl -so /dev/null -w '%{http_code}' --max-time 15 -H "Host: $h" http://127.0.0.1/)"
done
echo "  ufw で Cloudflare が遮断されていないか:"
if [ -f /etc/nginx/cloudflare-ips.txt ]; then
  blocked=0
  while read -r c; do
    ufw status | grep -q "${c%%/*}" && blocked=$((blocked+1))
  done < /etc/nginx/cloudflare-ips.txt
  echo "    遮断中の Cloudflare 範囲: $blocked（0 であるべき）"
fi
echo
echo "退避先: $BK"
echo "=== 完了。この後 Cloudflare 側の設定に進めます ==="
