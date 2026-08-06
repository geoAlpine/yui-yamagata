/**
 * OpenStreetMap から山形県のスポットを取り込む。
 *
 *   node --env-file=.env.local scripts/import_osm.mjs [--dry]
 *
 * ── ライセンス ──
 * OSM のデータは ODbL 1.0。出典表示が必要なので、取り込んだ場合は
 * 画面に「© OpenStreetMap contributors」を必ず出すこと（app/page.tsx の脚注）。
 *
 * ── 再実行について ──
 * spots は (osm_type, osm_id) で upsert する。消して作り直してはいけない。
 * observations が ON DELETE CASCADE で連鎖削除され、住民の報告が消えるため。
 *
 * ── 消えたスポットの扱い ──
 * 取り込みが「足すだけ」だと、閉店した店が営業中の候補として並んだまま
 * 災害を迎える。当初その状態だった（月次更新を回しても件数が単調増加する）。
 * そこで、今回のOSM応答に現れなかった取り込み済みスポットは失効させる。
 *
 * 失効は is_active=false であって DELETE ではない。行を消すと observations が
 * 連鎖削除されて住民の報告が失われる。再びOSMに現れれば upsert 側で
 * is_active=true に戻るので、判断は常にやり直せる。
 *
 * ただしOverpassは混雑時に部分的な結果を返す。それを「全部閉店した」と
 * 解釈すると本番のスポットが一斉に消える。カテゴリごとに既存件数と比べ、
 * 大きく下回った回は失効処理を見送る（SHRINK_FLOOR）。
 *
 * ── 何を取り込み、何を取り込まないか ──
 * 取り込むのは「災害時にその場所の“状況”を報告する意味があるもの」に限る。
 * 例えば amenity=drinking_water（常設の水飲み場）は取り込まない。
 * 断水すれば水飲み場も止まるので、「給水所」として出すとむしろ誤解を招く。
 * 給水所は自治体の応急給水拠点と利用者の報告に任せる。
 */

import { Pool } from 'pg';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DRY = process.argv.includes('--dry');

const QUERY = `
[out:json][timeout:180];
area["ISO3166-2"="JP-06"]->.a;
(
  nwr(area.a)["amenity"="fuel"];
  nwr(area.a)["shop"~"^(supermarket|convenience)$"];
  nwr(area.a)["amenity"~"^(pharmacy|hospital|clinic|doctors)$"];
  nwr(area.a)["amenity"~"^(atm|bank)$"];
  nwr(area.a)["shop"="laundry"];
  nwr(area.a)["amenity"="public_bath"];
  nwr(area.a)["amenity"="toilets"];
  nwr(area.a)["amenity"="charging_station"];
);
out center tags;
`;

/**
 * このスクリプトが扱うカテゴリ。失効処理をこの範囲に限る。
 * classify() が返しうる値と一致させること。
 */
const CATEGORIES = ['gas', 'store', 'medical', 'cash', 'toilet', 'charge', 'laundry'];

/**
 * 取得件数が既存件数のこの割合を下回ったカテゴリは失効処理を見送る。
 * 「一晩で2割の店が消える」ことは現実には起きない。起きたなら取り込み元の障害。
 */
const SHRINK_FLOOR = 0.8;

/** OSMのタグ → 本サイトのカテゴリ。該当しなければ null で捨てる */
function classify(t) {
  if (t.amenity === 'fuel') return 'gas';
  if (t.shop === 'supermarket' || t.shop === 'convenience') return 'store';
  if (['pharmacy', 'hospital', 'clinic', 'doctors'].includes(t.amenity)) return 'medical';
  if (t.amenity === 'atm') return 'cash';
  // 銀行はATMを備えているのが普通だが、確実ではないので atm=no は除く
  if (t.amenity === 'bank' && t.atm !== 'no') return 'cash';
  if (t.amenity === 'public_bath') return 'toilet';
  if (t.amenity === 'toilets') return 'toilet';
  if (t.amenity === 'charging_station') return 'charge';
  if (t.shop === 'laundry') {
    // クリーニング店は災害時の役に立たない。コインランドリーだけを拾う
    const name = t.name ?? '';
    if (t.self_service === 'yes' || /ランドリー|コインランドリー/.test(name)) return 'laundry';
    return null;
  }
  return null;
}

/** 名前。無名でも座標に意味がある種類だけ既定名を与える */
function nameOf(t, category) {
  if (t.name) return t.name.slice(0, 40);
  if (category === 'toilet' && t.amenity === 'toilets') return '公衆トイレ';
  if (category === 'charge') return '充電スタンド';
  if (category === 'cash' && t.amenity === 'atm') return 'ATM';
  return null; // 無名のスーパーや病院は情報として使えないので捨てる
}

function addressOf(t) {
  if (t['addr:full']) return t['addr:full'].slice(0, 80);
  const parts = [t['addr:province'], t['addr:city'], t['addr:suburb'], t['addr:neighbourhood'], t['addr:block_number'], t['addr:housenumber']];
  const s = parts.filter(Boolean).join('');
  return s ? s.slice(0, 80) : null;
}

/** 補足。災害時に効く属性だけを短く残す */
function noteOf(t, category) {
  const bits = [];
  if (t.opening_hours === '24/7') bits.push('24時間');
  if (category === 'toilet' && t.amenity === 'public_bath') {
    bits.push(t['bath:type'] === 'onsen' ? '温泉' : '入浴施設');
  }
  if (category === 'toilet' && t.wheelchair === 'yes') bits.push('車いす対応');
  if (category === 'medical' && t.amenity === 'pharmacy') bits.push('薬局');
  if (category === 'medical' && t.amenity === 'hospital') bits.push('病院');
  if (category === 'charge' && t.socket_type) bits.push('充電設備');
  return bits.length ? bits.join('・').slice(0, 60) : null;
}

/**
 * 「今回の応答に無かった取り込み済みスポット」の条件。
 *
 * source='imported' かつ osm_id を持つものだけを見る。国土地理院の避難所
 * （source='official' / gsi_id）、応急給水拠点、利用者が作ったスポットは
 * OSMに載っていなくて当然なので、巻き込むと全部消える。
 */
const VANISHED_WHERE = `
      source = 'imported' AND osm_id IS NOT NULL AND is_active
  AND category = ANY($1::text[])
  AND NOT EXISTS (
        SELECT 1 FROM unnest($2::text[], $3::bigint[]) AS seen(t, i)
         WHERE seen.t = spots.osm_type AND seen.i = spots.osm_id
      )`;

/**
 * OSMから消えたスポットを失効させる。dry のときは対象を出すだけで書き込まない。
 * 返り値は失効させた（させる予定の）件数。
 */
async function deactivateVanished(pool, rows, dry) {
  const fetched = {};
  for (const r of rows) fetched[r.category] = (fetched[r.category] ?? 0) + 1;

  const cur = await pool.query(
    `SELECT category, count(*)::int AS n
       FROM spots
      WHERE source = 'imported' AND osm_id IS NOT NULL AND is_active
        AND category = ANY($1::text[])
      GROUP BY category`,
    [CATEGORIES]
  );

  const targets = [];
  const held = [];
  for (const { category, n } of cur.rows) {
    const got = fetched[category] ?? 0;
    if (got < n * SHRINK_FLOOR) held.push({ category, n, got });
    else targets.push(category);
  }

  if (held.length) {
    process.stdout.write('\n★失効処理を見送ったカテゴリ（取得数が既存を大きく下回りました）:\n');
    for (const h of held) {
      process.stdout.write(`  ${h.category.padEnd(10)} 既存 ${h.n} → 取得 ${h.got}\n`);
    }
    process.stdout.write('  Overpassが部分的な結果を返した可能性があります。取り込み元を確認してください。\n');
  }

  if (!targets.length) return 0;

  // osm_id は JSON では数値だが、bigint[] に渡すので文字列にしておく
  const params = [targets, rows.map((r) => r.osmType), rows.map((r) => String(r.osmId))];
  const q = await pool.query(
    dry
      ? `SELECT name, category FROM spots WHERE ${VANISHED_WHERE} ORDER BY category, name`
      : `UPDATE spots SET is_active = false WHERE ${VANISHED_WHERE} RETURNING name, category`,
    params
  );

  if (!q.rows.length) return 0;

  const names = {};
  for (const r of q.rows) (names[r.category] ??= []).push(r.name);
  process.stdout.write(dry ? '\n失効させる予定:\n' : '\n失効（OSMから消えたスポット）:\n');
  for (const [k, v] of Object.entries(names).sort((a, b) => b[1].length - a[1].length)) {
    const head = v.slice(0, 5).join('、') + (v.length > 5 ? ' ほか' : '');
    process.stdout.write(`  ${k.padEnd(10)} ${String(v.length).padStart(5)}  ${head}\n`);
  }
  return q.rows.length;
}

async function main() {
  process.stdout.write('Overpass に問い合わせ中…\n');
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'user-agent': 'yamagata-bousai-import/0.1' },
    body: QUERY,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  process.stdout.write(`  取得: ${data.elements.length} 要素\n`);

  const rows = [];
  const skipped = { unnamed: 0, unclassified: 0, nocoord: 0 };

  for (const el of data.elements) {
    const t = el.tags ?? {};
    const category = classify(t);
    if (!category) { skipped.unclassified++; continue; }

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) { skipped.nocoord++; continue; }

    const name = nameOf(t, category);
    if (!name) { skipped.unnamed++; continue; }

    rows.push({
      osmType: el.type,
      osmId: el.id,
      name,
      category,
      lat,
      lng,
      address: addressOf(t),
      municipality: t['addr:city'] ?? null,
      note: noteOf(t, category),
    });
  }

  const byCat = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  process.stdout.write('\n取り込み対象:\n');
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${k.padEnd(10)} ${String(v).padStart(5)}\n`);
  }
  process.stdout.write(`  ${'合計'.padEnd(9)} ${String(rows.length).padStart(5)}\n`);
  process.stdout.write(`\n除外: 対象外タグ ${skipped.unclassified} / 無名 ${skipped.unnamed} / 座標なし ${skipped.nocoord}\n`);

  if (DRY) {
    // 失効の見込みだけは既存データと突き合わせないと出せない。読むだけで書かない。
    // 失効はこのスクリプトで唯一データを減らす処理なので、事前に見えることに意味がある。
    if (process.env.DATABASE_URL) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await deactivateVanished(pool, rows, true);
      } finally {
        await pool.end();
      }
    } else {
      process.stdout.write('\nDATABASE_URL が無いため、失効の見込みは出せません。\n');
    }
    process.stdout.write('\n--dry のため書き込みませんでした。\n');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = 0;
  let updated = 0;

  for (const r of rows) {
    // upsert。既存スポットを消さないことが重要（observations が連鎖削除されるため）
    const q = await pool.query(
      `INSERT INTO spots (name, category, location, address, municipality, note, source, osm_type, osm_id)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $5, $6, $7, 'imported', $8, $9)
       ON CONFLICT (osm_type, osm_id) WHERE osm_id IS NOT NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         address = COALESCE(EXCLUDED.address, spots.address),
         municipality = COALESCE(EXCLUDED.municipality, spots.municipality),
         note = COALESCE(EXCLUDED.note, spots.note),
         -- OSMに戻ってきたものは復活させる。マッパーの誤削除や、Overpassの
         -- 部分応答で誤って失効させた場合に、次の回で自動的に元へ戻る
         is_active = true
       RETURNING (xmax = 0) AS is_insert`,
      [r.name, r.category, r.lat, r.lng, r.address, r.municipality, r.note, r.osmType, r.osmId]
    );
    if (q.rows[0].is_insert) inserted++; else updated++;
  }

  const gone = await deactivateVanished(pool, rows, false);

  const total = await pool.query(`SELECT count(*)::int AS n FROM spots WHERE is_active`);
  process.stdout.write(`\n新規 ${inserted} / 更新 ${updated} / 失効 ${gone}\n`);
  process.stdout.write(`スポット総数: ${total.rows[0].n}\n`);
  await pool.end();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
