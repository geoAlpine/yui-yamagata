/**
 * 住民拠点SS（停電時も給油できる自家発電設備付きの給油所）を反映する。
 *
 *   node --env-file=.env.local scripts/import_juminss.mjs data/juminss_yamagata.csv [--dry]
 *
 * ── なぜ手動ダウンロードなのか ──
 * 資源エネルギー庁は一覧を Excel/PDF で公開しているが、サイトが自動取得を弾く
 * （302/403）うえ、URLも改定のたびに変わる。取得を自動化すると更新のたびに壊れ、
 * 壊れたことに気づかないまま古いデータを配ることになる。
 * 年に数回の更新なので、人が落として通す方が確実で安全。
 *
 * ── 入手方法 ──
 *   資源エネルギー庁「住民拠点サービスステーション」のページから
 *   最新の一覧（Excel）を落とし、山形県の行だけを CSV で保存する。
 *   文字コードは UTF-8 か Shift_JIS のどちらでもよい。
 *   必要な列は「SS名（給油所名）」と「所在地（住所）」の2つだけ。
 *
 * ── 突き合わせの方法 ──
 * 一覧に緯度経度は入っていないので、既に取り込んである OSM の給油所
 * （category='gas'）に突き合わせて is_priority を立てる。
 *
 * まず名前で照合するが、これだけでは足りない。OSM側の給油所名は
 * 「エネオス」80件・「JA」30件のようにブランド名だけのことが多く、
 * 283件中240件が同名、同一市町村内でも115件が重複する。
 *
 * そこで名前で決まらない行は、国土地理院の住所検索で座標を出し、
 * 最寄りの給油所に当てる。地理院APIは取り込み時に一度使うだけで、
 * 結果はDBに焼き付くため、サイトの実行時に外部依存は残らない。
 * （災害時に落ちるものに頼らない、という方針は保たれる）
 *
 * 突き合わなかった行は必ず一覧で報告し、黙って捨てない。
 * 黙って捨てると「載っているはず」の思い込みが残る。
 */

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const FILE = process.argv[2];
const DRY = process.argv.includes('--dry');
const NO_GEO = process.argv.includes('--no-geocode');

const GSI = 'https://msearch.gsi.go.jp/address-search/AddressSearch';
const GEO_RADIUS_M = 400; // 住所の代表点と実際の給油所のずれを見込む
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 国土地理院の住所検索。取り込み時に一度だけ使う。
 *
 * 注意: 住所が解決できないと、地理院は黙って市区町村の代表点を返す。
 *   「山形県山形市存在しない町9999」→ title='山形県山形市'
 * これをそのまま使うと、市役所の近くにある無関係な給油所が
 * 「自家発電あり」と表示され、停電時に人を無駄足させる。
 * 町名以下まで解決できた結果だけを採用する。
 */
async function geocode(address) {
  try {
    const res = await fetch(`${GSI}?q=${encodeURIComponent(address)}`, {
      headers: { 'user-agent': 'yamagata-bousai-import/0.1' },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!Array.isArray(d) || !d.length) return null;

    const title = d[0].properties?.title ?? '';
    // 「(都道府県)(市区町村)(それ以降)」に分け、それ以降が空なら市レベルの当て推量
    const m = title.match(/^(?:.+?[都道府県])?.+?[市区町村](.*)$/);
    if (!m || !m[1].trim()) return null;

    const [lng, lat] = d[0].geometry.coordinates;
    return { lat, lng, title };
  } catch {
    return null;
  }
}

if (!FILE) {
  process.stderr.write('使い方: node scripts/import_juminss.mjs <CSVファイル> [--dry]\n');
  process.exit(1);
}

/** Shift_JIS でも UTF-8 でも読めるようにする */
function readText(path) {
  const buf = readFileSync(path);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // 文字化けの目印（U+FFFD）が多ければ Shift_JIS とみなす
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 5) return new TextDecoder('shift_jis').decode(buf);
  return utf8;
}

/** 引用符付きCSVを素直に解く。区切りはカンマかタブ */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const delim = text.split('\n')[0].includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * 名寄せ用の正規化。
 * 「(株)」「有限会社」「SS」「サービスステーション」「給油所」など、
 * 事業者側とOSM側で揺れる表記を落として比較しやすくする。
 */
function normalize(s) {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\)|㈱|㈲)/g, '')
    .replace(/(サービスステーション|ステーション|给油所|給油所|ＳＳ|SS)/gi, '')
    .replace(/(店|営業所|支店)$/g, '')
    .replace(/[\s・,，.。\-ー―−]/g, '')
    .toLowerCase();
}

function pickColumns(header) {
  const find = (...pats) =>
    header.findIndex((h) => pats.some((p) => h && h.includes(p)));
  return {
    name: find('SS名', '給油所名', '事業所名', '施設名', '店名', '名称'),
    address: find('所在地', '住所'),
  };
}

async function main() {
  const rows = parseCsv(readText(FILE));
  if (rows.length < 2) throw new Error('行がありません');

  // ヘッダ行は先頭とは限らない（Excelの体裁で数行空くことがある）
  let headerIdx = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const c = pickColumns(rows[i]);
    if (c.name >= 0 && c.address >= 0) { headerIdx = i; cols = c; break; }
  }
  if (!cols) {
    throw new Error(
      'SS名と所在地の列が見つかりません。ヘッダに「SS名」「所在地」を含む列が必要です。\n' +
      `先頭行: ${rows[0].join(' | ')}`
    );
  }

  const entries = rows.slice(headerIdx + 1)
    .map((r) => ({ name: (r[cols.name] ?? '').trim(), address: (r[cols.address] ?? '').trim() }))
    .filter((e) => e.name);
  process.stdout.write(`読み込み: ${entries.length} 件\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const gas = (await pool.query(
    `SELECT id, name, address, municipality FROM spots WHERE is_active AND category = 'gas'`
  )).rows;
  process.stdout.write(`照合先の給油所: ${gas.length} 件\n\n`);

  const index = new Map();
  for (const g of gas) {
    const k = normalize(g.name);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(g);
  }

  const matched = [];
  const unmatched = [];

  for (const e of entries) {
    const key = normalize(e.name);
    let hits = index.get(key) ?? [];

    // 完全一致がなければ部分一致で拾う。
    // ただし緩くしすぎてはいけない。「スタンド」のような短い共通語で
    // 何にでも当たると、実在しない給油所を「自家発電あり」と表示することになり、
    // 停電時に人を無駄足させる。長さと重なりの割合で歯止めをかける。
    if (hits.length === 0 && key.length >= 4) {
      hits = gas.filter((g) => {
        const gk = normalize(g.name);
        if (gk.length < 4) return false;
        if (!gk.includes(key) && !key.includes(gk)) return false;
        // 短い方が長い方の6割以上を占めていること
        return Math.min(gk.length, key.length) / Math.max(gk.length, key.length) >= 0.6;
      });
    }
    // 複数当たったら、住所の市町村名で絞る
    if (hits.length > 1 && e.address) {
      const narrowed = hits.filter(
        (g) => g.municipality && e.address.includes(g.municipality)
      );
      if (narrowed.length) hits = narrowed;
    }

    if (hits.length === 1) matched.push({ entry: e, spot: hits[0], by: '名前' });
    else unmatched.push({ entry: e, reason: hits.length === 0 ? '該当なし' : `候補${hits.length}件`, hits });
  }

  // 名前で決まらなかった行を、住所の座標から最寄りの給油所に当てる。
  // OSM側の給油所名はブランド名だけのことが多く、名前だけでは大半が決まらない。
  const stillUnmatched = [];
  if (!NO_GEO && unmatched.length) {
    process.stdout.write(`名前で決まらなかった ${unmatched.length} 件を住所から照合中…\n`);
    for (const u of unmatched) {
      if (!u.entry.address) { stillUnmatched.push(u); continue; }
      const pt = await geocode(u.entry.address);
      await sleep(300); // 地理院APIへの礼儀
      if (!pt) { u.reason = '住所を町名まで特定できず'; stillUnmatched.push(u); continue; }

      // 名前で候補が複数出ていたなら、その中から最寄りを選ぶ。
      // 候補が無かった場合は全給油所から探す。
      const pool2 = u.hits && u.hits.length ? u.hits : gas;
      const r = await pool.query(
        `SELECT id, name, ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS d
         FROM spots WHERE id = ANY($3::uuid[])
         ORDER BY d LIMIT 1`,
        [pt.lng, pt.lat, pool2.map((g) => g.id)]
      );
      const best = r.rows[0];
      if (best && best.d <= GEO_RADIUS_M) {
        matched.push({ entry: u.entry, spot: best, by: `住所 ${Math.round(best.d)}m` });
      } else {
        u.reason = best ? `最寄りでも ${Math.round(best.d)}m` : '該当なし';
        stillUnmatched.push(u);
      }
    }
    unmatched.length = 0;
    unmatched.push(...stillUnmatched);
    process.stdout.write('\n');
  }

  const byName = matched.filter((m) => m.by === '名前').length;
  process.stdout.write(`突合できた: ${matched.length} 件（名前 ${byName} / 住所 ${matched.length - byName}）\n`);
  process.stdout.write(`突合できなかった: ${unmatched.length} 件\n\n`);

  if (!DRY && matched.length) {
    await pool.query(
      `UPDATE spots SET is_priority = true,
              note = COALESCE(NULLIF(note,''), '') ||
                     CASE WHEN COALESCE(note,'') LIKE '%自家発電%' THEN ''
                          ELSE CASE WHEN COALESCE(note,'') = '' THEN '' ELSE '・' END || '自家発電あり（住民拠点SS）' END
       WHERE id = ANY($1::uuid[])`,
      [matched.map((m) => m.spot.id)]
    );
    process.stdout.write(`is_priority を立てました: ${matched.length} 件\n\n`);
  }

  // 突合できなかった行は必ず出す。黙って捨てると「載っているはず」の思い込みが残る
  if (unmatched.length) {
    process.stdout.write('── 手当てが必要な行 ──\n');
    for (const u of unmatched.slice(0, 40)) {
      process.stdout.write(`  [${u.reason}] ${u.entry.name}  ${u.entry.address}\n`);
    }
    if (unmatched.length > 40) {
      process.stdout.write(`  …ほか ${unmatched.length - 40} 件\n`);
    }
    process.stdout.write(
      '\nOSMに存在しない給油所は、アプリの「場所を追加」から登録するか、\n' +
      'OSM側に登録すると次回の取り込みで拾えます。\n'
    );
  }

  await pool.end();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
