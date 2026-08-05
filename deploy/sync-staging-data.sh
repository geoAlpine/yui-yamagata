#!/bin/bash
# 本番の「参照データ」だけをステージングへ写す。
#
# ★ observations / confirmations / notices / reports は写さない。
#   投稿者のIPと匿名ID、団体の連絡先が入っている。これは住民と団体のもので、
#   動作確認のために複製してよいものではない。
#
# 写すのは spots（店舗・給水拠点の位置）だけ。これは公開情報の集約であり、
# OSMと自治体の公表データから作られている。created_ip だけは落とす。
#
# 用途: ステージングでUIを確かめるための土台。
#       住民の報告は、ステージング上で自分で投稿して作る。
set -uo pipefail

PROD=$(grep DATABASE_URL /etc/yui/production.env | cut -d= -f2-)
STG=$(grep DATABASE_URL /etc/yui/staging.env | cut -d= -f2-)

echo "=== 同期前 ==="
echo "  本番:       $(psql "$PROD" -tAc 'select count(*) from spots') spots"
echo "  ステージング: $(psql "$STG"  -tAc 'select count(*) from spots') spots"

echo "=== spots を入れ替え ==="
# 観測が紐づいていれば CASCADE で消えるが、ステージングの観測は
# 動作確認で作ったものなので消えて構わない
psql "$STG" -q -c "TRUNCATE spots CASCADE;"

psql "$PROD" -tAc "COPY (
  SELECT name, category, ST_AsEWKT(location::geometry), address, municipality,
         note, source, is_priority, is_active, osm_type, osm_id
  FROM spots
) TO STDOUT WITH (FORMAT csv)" \
| psql "$STG" -q -c "COPY spots (name, category, location, address, municipality,
         note, source, is_priority, is_active, osm_type, osm_id)
  FROM STDIN WITH (FORMAT csv)"

echo "=== 同期後 ==="
echo "  ステージング: $(psql "$STG" -tAc 'select count(*) from spots') spots"
echo "  個人情報の混入確認:"
echo "    created_ip が入った行: $(psql "$STG" -tAc 'select count(*) from spots where created_ip is not null')（0が正しい）"
echo "    observations:          $(psql "$STG" -tAc 'select count(*) from observations')（0が正しい）"
echo "    notices:               $(psql "$STG" -tAc 'select count(*) from notices')（0が正しい）"
echo "  カテゴリ別:"
psql "$STG" -tAc "select '    '||category||': '||count(*) from spots where is_active group by category order by count(*) desc"
