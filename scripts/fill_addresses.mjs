/**
 * 住所が入っていないスポットに、町名を埋める。
 *
 *   node --env-file=.env.local scripts/fill_addresses.mjs [--dry] [--limit N]
 *
 * ── なぜ要るか ──
 * OSM由来のスポットは名前がブランド名だけのことが多く、住所も1〜2割しか入っていない。
 * 結果、一覧がこうなる:
 *
 *   エネオス      617m
 *   ゼネラル石油   647m
 *   エネオス      924m
 *   エネオス     1.2km
 *
 * どれがどれだか分からない。災害時に「さっき見たスタンド」を探せない。
 * 町名が付けば「エネオス（山形市香澄町三丁目）」となり区別できる。
 *
 * ── 外部依存を実行時に持ち込まない ──
 * 国土地理院の逆ジオコーディングを使うが、叩くのは取り込み時の一度だけで、
 * 結果はDBに焼き付く。サイトの実行時に外部APIへ出ることはない。
 * 「災害時に落ちるものに頼らない」という方針は保たれる。
 *
 * 避難所・避難場所は国土地理院のデータに住所が100%入っているので対象外。
 */

import { Pool } from 'pg';

const GSI = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const DRY = process.argv.includes('--dry');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? Number(process.argv[i + 1]) : Infinity;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverse(lat, lng) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${GSI}?lat=${lat}&lon=${lng}`, {
        headers: { 'user-agent': 'yamagata-bousai-import/0.1' },
      });
      if (res.ok) {
        const d = (await res.json())?.results;
        // lv01Nm が「－」のことがある。町名が定まらない場所（山中など）
        const name = d?.lv01Nm;
        return name && name !== '－' ? name : null;
      }
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * attempt); continue; }
      return null;
    } catch {
      await sleep(3000 * attempt);
    }
  }
  return null;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(
    `SELECT id, name, municipality,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM spots
     WHERE is_active AND address IS NULL
     ORDER BY category, name
     LIMIT $1`,
    [Number.isFinite(LIMIT) ? LIMIT : 100000]
  );
  process.stdout.write(`住所が無いスポット: ${rows.length} 件\n\n`);

  let filled = 0, missed = 0;
  for (const [i, r] of rows.entries()) {
    const town = await reverse(r.lat, r.lng);
    await sleep(120); // 地理院への礼儀

    if (!town) { missed++; continue; }
    // 「山形市」＋「香澄町三丁目」の形にする。市町村は既に100%入っている
    const address = [r.municipality, town].filter(Boolean).join('');

    if (DRY) {
      if (i < 12) process.stdout.write(`  ${r.name.slice(0, 22).padEnd(24)} → ${address}\n`);
    } else {
      await pool.query(`UPDATE spots SET address = $2 WHERE id = $1`, [r.id, address]);
    }
    filled++;

    if ((i + 1) % 200 === 0) {
      process.stdout.write(`  ${i + 1}/${rows.length} 処理済み（取得 ${filled} / 取れず ${missed}）\n`);
    }
  }

  process.stdout.write(`\n${DRY ? '取得できた' : '埋めた'}: ${filled} 件 / 町名が取れず: ${missed} 件\n`);

  if (!DRY) {
    const q = await pool.query(
      `SELECT count(*)::int AS total, count(address)::int AS with_addr FROM spots WHERE is_active`
    );
    const { total, with_addr } = q.rows[0];
    process.stdout.write(`住所あり: ${with_addr}/${total}（${Math.round((100 * with_addr) / total)}%）\n`);
  }
  await pool.end();
}

main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + '\n'); process.exit(1); });
