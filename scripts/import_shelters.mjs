/**
 * 指定緊急避難場所・指定避難所を国土地理院から取り込む。
 *
 *   node --env-file=.env.local scripts/import_shelters.mjs [--dry]
 *
 * ── 出典と利用条件 ──
 * 国土地理院「指定緊急避難場所・指定避難所データ」。
 * 災害対策基本法に基づき市町村長が指定したものを、各市町村が登録している。
 *
 * 利用上の注意（国土地理院が第三者提供時にも正確に伝えるよう求めているもの）:
 *   1. 最新でない場合や未掲載の場合がある。最新かつ詳細は当該市町村に確認すること
 *   2. 「指定緊急避難場所」と「指定避難所」は別物
 *   3. 指定緊急避難場所は災害種別ごとに指定されている
 * → これらは画面（app/page.tsx の脚注とカード）に必ず出す。消してはいけない。
 *
 * ── 2種類を混同しない ──
 *   指定緊急避難場所（_2） 発災時に緊急で逃げる場所。災害種別ごとに指定
 *   指定避難所（_1）       災害後に滞在する場所
 * 地震向けに指定された場所が洪水では使えないことがある。
 * 「避難場所だから安全」ではなく「この災害に対して安全」が正しい。
 * 種別を hazards 配列で保持し、画面にも出す。
 *
 * ── 「指定されている」と「今開いている」は別物 ──
 * 公式が言えるのは前者だけ。後者は発災後に自治体が発表するが更新が遅く、
 * 住民の目撃が先行する。そこが本サイトの持ち場（spots ← observations）。
 */

import { Pool } from 'pg';

const BASE = 'https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData';
const DRY = process.argv.includes('--dry');
const PREF = '06'; // 山形県

/** CSVの災害種別カラム → hazards のID。列の並びはCSVのヘッダに従う */
const HAZARD_COLUMNS = [
  ['洪水', 'flood'],
  ['崖崩れ', 'landslide'],
  ['高潮', 'storm_surge'],
  ['地震', 'earthquake'],
  ['津波', 'tsunami'],
  ['火事', 'fire'],
  ['内水', 'inland_flood'],
  ['火山', 'volcano'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'yamagata-bousai-import/0.1' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  // BOM付きUTF-8で配信されている
  return parseCsv(new TextDecoder('utf-8').decode(await res.arrayBuffer()).replace(/^﻿/, ''));
}

/** 対象市町村の一覧（公開しているものだけ） */
async function municipalities() {
  const rows = await fetchCsv(`${BASE}/publicHistoryCSV/publicHistoryListData.csv`);
  return rows
    .filter((r) => r[0]?.startsWith(PREF))
    .map((r) => ({ code: r[0], name: (r[1] ?? '').replace(/^山形県/, '') }));
}

function extract(rows, category) {
  const head = rows[0];
  const col = (...pats) => head.findIndex((h) => pats.some((p) => h?.includes(p)));
  const iName = col('施設', '名称');
  const iAddr = col('住所');
  const iId = col('共通ID');
  const iLat = col('緯度');
  const iLng = col('経度');
  const iNote = col('備考');
  if (iName < 0 || iLat < 0 || iLng < 0) return [];

  // 災害種別の列位置を、ヘッダ名から引く
  const hazardIdx = HAZARD_COLUMNS
    .map(([pat, id]) => [head.findIndex((h) => h?.includes(pat)), id])
    .filter(([i]) => i >= 0);

  const out = [];
  for (const r of rows.slice(1)) {
    const name = (r[iName] ?? '').trim().replace(/　/g, ' ');
    const lat = Number(r[iLat]);
    const lng = Number(r[iLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    // 空欄でない＝その災害種別に対応。○ や 1 など表記が揺れるので「空でない」で判定
    const hazards = category === 'evacuation'
      ? hazardIdx.filter(([i]) => (r[i] ?? '').trim() !== '').map(([, id]) => id)
      : null;

    out.push({
      gsiId: (r[iId] ?? '').trim() || null,
      name: name.slice(0, 60),
      category,
      lat, lng,
      address: (r[iAddr] ?? '').trim().slice(0, 80) || null,
      note: (r[iNote] ?? '').trim().slice(0, 60) || null,
      hazards,
    });
  }
  return out;
}

async function main() {
  const munis = await municipalities();
  process.stdout.write(`山形県の公開市町村: ${munis.length}\n\n`);

  const all = [];
  for (const m of munis) {
    // _2 = 指定緊急避難場所（災害種別あり） / _1 = 指定避難所
    const [ev, sh] = await Promise.all([
      fetchCsv(`${BASE}/csv/${m.code}_2.csv`).catch(() => null),
      fetchCsv(`${BASE}/csv/${m.code}_1.csv`).catch(() => null),
    ]);
    const a = ev ? extract(ev, 'evacuation') : [];
    const b = sh ? extract(sh, 'shelter') : [];
    for (const x of [...a, ...b]) all.push({ ...x, municipality: m.name });
    process.stdout.write(`  ${m.name.padEnd(8)} 避難場所 ${String(a.length).padStart(4)} / 避難所 ${String(b.length).padStart(4)}\n`);
    await sleep(200); // 地理院への礼儀
  }

  const ev = all.filter((x) => x.category === 'evacuation');
  const sh = all.filter((x) => x.category === 'shelter');
  process.stdout.write(`\n合計: 緊急避難場所 ${ev.length} / 避難所 ${sh.length}\n`);

  const byHazard = {};
  for (const x of ev) for (const h of x.hazards ?? []) byHazard[h] = (byHazard[h] ?? 0) + 1;
  process.stdout.write('緊急避難場所の災害種別:\n');
  for (const [k, v] of Object.entries(byHazard).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${k.padEnd(14)} ${v}\n`);
  }
  const noHazard = ev.filter((x) => !x.hazards?.length).length;
  if (noHazard) process.stdout.write(`  （種別の記載なし: ${noHazard}）\n`);

  if (DRY) { process.stdout.write('\n--dry のため書き込みませんでした。\n'); return; }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let ins = 0, upd = 0, skipped = 0;
  for (const x of all) {
    if (!x.gsiId) { skipped++; continue; } // 共通IDが無いものは一意にできないので入れない
    const q = await pool.query(
      `INSERT INTO spots (name, category, location, address, municipality, note,
                          source, gsi_id, hazards)
       VALUES ($1,$2,ST_SetSRID(ST_MakePoint($4,$3),4326),$5,$6,$7,'official',$8,$9)
       ON CONFLICT (gsi_id) WHERE gsi_id IS NOT NULL
       DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
         location=EXCLUDED.location, address=EXCLUDED.address,
         municipality=EXCLUDED.municipality, note=EXCLUDED.note,
         hazards=EXCLUDED.hazards, is_active=true
       RETURNING (xmax = 0) AS is_insert`,
      [x.name, x.category, x.lat, x.lng, x.address, x.municipality, x.note, x.gsiId, x.hazards]
    );
    if (q.rows[0].is_insert) ins++; else upd++;
  }
  const total = await pool.query(`SELECT count(*)::int AS n FROM spots WHERE is_active`);
  process.stdout.write(`\n新規 ${ins} / 更新 ${upd}${skipped ? ` / 共通IDなしで除外 ${skipped}` : ''}\n`);
  process.stdout.write(`スポット総数: ${total.rows[0].n}\n`);
  await pool.end();

  process.stdout.write(
    '\n出典表示が必要。画面から国土地理院の表記と「利用上の注意」を消さないこと。\n'
  );
}

main().catch((e) => { process.stderr.write(String(e?.stack ?? e) + '\n'); process.exit(1); });
