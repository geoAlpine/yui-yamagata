/**
 * 各スポットに市町村を割り当てる。
 *
 *   node --env-file=.env.local scripts/assign_municipality.mjs
 *
 * OSM の addr:city は日本ではほとんど付いていない（取り込み2793件中2489件が空）。
 * かといって逆ジオコーディングAPIに依存はしたくない。災害時に落ちるものに頼らない、
 * というのが本サイトの方針なので、外部APIを常時呼ぶ設計にはできない。
 *
 * そこで「行政界のポリゴンを持ってきて点在判定する」代わりに、
 * Overpass の area 機能に判定そのものをやらせる。市町村ごとに
 * 「その市町村エリア内にある対象要素のID一覧」だけを取得し（out ids なので応答は軽い）、
 * ローカルの spots に突き合わせて更新する。
 *
 * ポリゴンの穴・飛び地・複数リングの扱いを自前で書かずに済み、
 * かつ判定結果はDBに焼き付くので、実行時に外部依存が残らない。
 */

import { Pool } from 'pg';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const SLEEP_MS = 5000; // Overpass への礼儀。公開インスタンスは同時実行枠が少ない
const RESUME = !process.argv.includes('--fresh');

const TARGETS = `
  nwr(area.a)["amenity"="fuel"];
  nwr(area.a)["shop"~"^(supermarket|convenience)$"];
  nwr(area.a)["amenity"~"^(pharmacy|hospital|clinic|doctors)$"];
  nwr(area.a)["amenity"~"^(atm|bank)$"];
  nwr(area.a)["shop"="laundry"];
  nwr(area.a)["amenity"="public_bath"];
  nwr(area.a)["amenity"="toilets"];
  nwr(area.a)["amenity"="charging_station"];
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    let res;
    try {
      res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', 'user-agent': 'yamagata-bousai-import/0.1' },
        body: query,
      });
    } catch {
      await sleep(15000);
      continue;
    }
    if (res.ok) return res.json();
    // 429 = 同時実行枠の空き待ち / 504 = 混雑。どちらも待てば通る
    const wait = res.status === 429 ? 30000 : 15000 * attempt;
    process.stdout.write(`  ${label}: HTTP ${res.status}（${attempt}回目、${wait / 1000}秒待機）\n`);
    await sleep(wait);
  }
  throw new Error(`${label}: Overpass に繋がりませんでした`);
}

async function main() {
  process.stdout.write('山形県の市町村一覧を取得中…\n');
  // admin_level=7 が日本の市町村にあたる
  const list = await overpass(
    `[out:json][timeout:120];
     area["ISO3166-2"="JP-06"]->.p;
     rel(area.p)["admin_level"="7"]["boundary"="administrative"];
     out tags;`,
    '市町村一覧'
  );
  const municipalities = list.elements
    .map((e) => e.tags?.name)
    .filter(Boolean)
    .sort();
  process.stdout.write(`  ${municipalities.length} 市町村\n\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let totalUpdated = 0;

  // 途中で止まっても続きから流せるようにする。
  // Overpass は混雑すると 429/504 を返すので、一発で終わる前提に立たない。
  //
  // 「その市町村のスポットが既にあるか」で判定してはいけない。
  // OSM の addr:city が付いていた分だけで処理済みに見えてしまい、
  // 大きな市（山形市・鶴岡市など）がまるごと飛ばされる。処理そのものを記録する。
  const done = new Set();
  if (RESUME) {
    const r = await pool.query(`SELECT key FROM import_progress WHERE key LIKE 'muni:%'`);
    for (const row of r.rows) done.add(row.key.slice(5));
    if (done.size) process.stdout.write(`  済み ${done.size} 市町村を飛ばします（--fresh で全件やり直し）\n\n`);
  }

  for (const [i, name] of municipalities.entries()) {
    if (done.has(name)) {
      process.stdout.write(`  [${String(i + 1).padStart(2)}/${municipalities.length}] ${name.padEnd(8)} 済\n`);
      continue;
    }
    const data = await overpass(
      `[out:json][timeout:120];
       area["name"="${name}"]["admin_level"="7"]->.a;
       (${TARGETS});
       out ids;`,
      name
    );

    // 型ごとにIDをまとめる。node/way/relation で番号空間が別なので分けて突き合わせる
    const byType = { node: [], way: [], relation: [] };
    for (const e of data.elements) byType[e.type]?.push(e.id);

    let n = 0;
    for (const [type, ids] of Object.entries(byType)) {
      if (!ids.length) continue;
      const r = await pool.query(
        `UPDATE spots SET municipality = $1
         WHERE osm_type = $2 AND osm_id = ANY($3::bigint[])
           AND municipality IS DISTINCT FROM $1`,
        [name, type, ids]
      );
      n += r.rowCount;
    }
    await pool.query(
      `INSERT INTO import_progress (key) VALUES ($1)
       ON CONFLICT (key) DO UPDATE SET done_at = now()`,
      [`muni:${name}`]
    );
    totalUpdated += n;
    process.stdout.write(
      `  [${String(i + 1).padStart(2)}/${municipalities.length}] ${name.padEnd(8)} ${String(n).padStart(4)} 件\n`
    );
    await sleep(SLEEP_MS);
  }

  const left = await pool.query(
    `SELECT count(*)::int AS n FROM spots WHERE is_active AND municipality IS NULL`
  );
  process.stdout.write(`\n更新 ${totalUpdated} 件 / 市町村が未設定のまま ${left.rows[0].n} 件\n`);
  await pool.end();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
