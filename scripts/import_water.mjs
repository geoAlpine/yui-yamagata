/**
 * 応急給水拠点を取り込む。
 *
 *   node --env-file=.env.local scripts/import_water.mjs [--dry]
 *
 * ── なぜ平時に取り込めるのか ──
 * 当初「給水所は災害時に生まれるもの」と分類していたが、これは誤りだった。
 * 応急給水拠点は自治体が**平時から指定して公表している**（耐震性貯水槽、
 * 学校の災害用貯水槽、配水池など）。発災してから場所を探す必要はない。
 *
 * 災害時に真っ先に必要になるカテゴリなので、平時のうちに入れておく。
 * これは「発災してから作らなくて済む状態を平時に用意する」というプロジェクトの
 * 目的そのもの。
 *
 * ── 出典と再取り込み ──
 * 山形市上下水道部が公開している拠点給水所マップ（Googleマイマップ）のKML。
 * 出典表示のうえで利用する。source='official' として利用者投稿と区別する。
 * 再実行は upsert なので安全（observations は消えない）。
 *
 * 他市町村は公開形式がバラバラなので、SOURCES に足していく形にする。
 */

import { Pool } from 'pg';

const DRY = process.argv.includes('--dry');

const SOURCES = [
  {
    municipality: '山形市',
    label: '山形市上下水道部 拠点給水所マップ',
    // Googleマイマップは forcekml=1 で素のKMLを返す
    url: 'https://www.google.com/maps/d/kml?mid=1jd5hgUSCQuQhstQx1kXyKLv5Lea-jCc&forcekml=1',
    // 震度5弱以上で開設される、という条件を補足に残す
    note: '震度5弱以上の地震で開設される拠点給水所',
  },
];

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** KMLから Placemark を取り出す。name と座標だけ使う */
function parseKml(xml) {
  const out = [];
  for (const pm of xml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? []) {
    const n = pm.match(/<name>([\s\S]*?)<\/name>/);
    const c = pm.match(/<coordinates>\s*(-?[\d.]+),(-?[\d.]+)/);
    if (!n || !c) continue;

    const raw = unescapeXml(n[1]).trim();
    // 「第二公園（給水所）」→「第二公園」。カテゴリ名は別に持つので冗長
    const name = raw.replace(/[（(]給水所[)）]\s*$/, '').trim();

    // 説明文から住所だけ拾う。「〇住所　山形市十日町４丁目…〇給水所の開設位置…」
    const d = pm.match(/<description>([\s\S]*?)<\/description>/);
    let address = null;
    let where = null;
    if (d) {
      const text = unescapeXml(d[1]).replace(/<[^>]*>/g, ' ');
      const a = text.match(/住所[　\s]*([^〇\n]+)/);
      if (a) address = a[1].trim().slice(0, 80);
      const w = text.match(/開設位置[　\s]*([^〇\n]+)/);
      if (w) where = w[1].trim().slice(0, 40);
    }

    out.push({ name, lng: Number(c[1]), lat: Number(c[2]), address, where });
  }
  return out;
}

async function main() {
  const pool = DRY ? null : new Pool({ connectionString: process.env.DATABASE_URL });
  let total = 0;

  for (const src of SOURCES) {
    process.stdout.write(`${src.municipality}: ${src.label}\n`);
    const res = await fetch(src.url, { headers: { 'user-agent': 'yamagata-bousai-import/0.1' } });
    if (!res.ok) {
      process.stderr.write(`  取得に失敗しました (HTTP ${res.status})\n`);
      continue;
    }
    const points = parseKml(await res.text());
    process.stdout.write(`  ${points.length} 箇所\n`);

    for (const p of points) {
      // 開設位置（「公園北側」など）は現地で迷わないための情報なので残す
      const note = [src.note, p.where && `開設位置: ${p.where}`].filter(Boolean).join(' / ').slice(0, 60);

      if (DRY) {
        process.stdout.write(`    ${p.name.padEnd(20)} ${p.lat.toFixed(5)},${p.lng.toFixed(5)}  ${p.address ?? ''}\n`);
        total++;
        continue;
      }

      // OSM由来ではないので osm_id は使えない。名前＋市町村＋カテゴリで一意とみなす。
      // 消して作り直してはいけない（observations が連鎖削除される）。
      const existing = await pool.query(
        `SELECT id FROM spots WHERE category='water' AND municipality=$1 AND name=$2`,
        [src.municipality, p.name]
      );
      if (existing.rows.length) {
        await pool.query(
          `UPDATE spots SET location=ST_SetSRID(ST_MakePoint($2,$3),4326),
                            address=COALESCE($4,address), note=$5, source='official', is_active=true
           WHERE id=$1`,
          [existing.rows[0].id, p.lng, p.lat, p.address, note]
        );
      } else {
        await pool.query(
          `INSERT INTO spots (name, category, location, address, municipality, note, source)
           VALUES ($1,'water',ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,'official')`,
          [p.name, p.lng, p.lat, p.address, src.municipality, note]
        );
      }
      total++;
    }
  }

  process.stdout.write(`\n${DRY ? '取り込み対象' : '取り込み済み'}: ${total} 箇所\n`);
  if (!DRY) {
    const n = await pool.query(`SELECT count(*)::int AS n FROM spots WHERE category='water' AND is_active`);
    process.stdout.write(`給水所の総数: ${n.rows[0].n}\n`);
    await pool.end();
  }
  process.stdout.write(
    '\n出典表示が必要。画面の脚注に自治体名を出すこと（app/page.tsx）。\n' +
    '他市町村は公開形式がバラバラなので、SOURCES に足していく。\n'
  );
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
