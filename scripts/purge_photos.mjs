/**
 * 期限を過ぎた写真と、公開すべきでなくなった写真を消す。
 *
 *   node --env-file=.env.local scripts/purge_photos.mjs [--dry]
 *
 * ── なぜ要るか ──
 * 詳細ページの写真にこう書いてある:
 *
 *   「住民が撮影した写真です。14日で自動的に消えます。」
 *
 * これは利用者への約束であって、飾りではない。実装がなければ嘘になる。
 * 顔や車のナンバーが写り込んだ写真が永久に残ることを意味する。
 *
 * ── 3種類を消す ──
 *
 *   1. 期限切れ（14日）
 *      災害の情報にTTLがあるのと同じ理屈。2週間前の行列の写真に価値はない。
 *
 *   2. 管理者が伏せた報告（is_hidden）
 *      画面から消えても、/uploads/ のURLを直接叩けば見られる。
 *      「伏せた」ことにならない。期限を待たず即座に消す。
 *
 *   3. 投稿者が取り下げた報告（withdrawn_at）
 *      本人が消したいと言っているものを14日残す理由がない。
 *
 * ── DBとファイルの両方を消す ──
 * photo_path を NULL にするだけではファイルが残り、
 * ファイルだけ消すとページに壊れた画像が出る。必ず両方。
 * 先にファイルを消してからDBを更新する。逆にすると、
 * 途中で落ちたときにDBから辿れない孤児ファイルが残る。
 *
 * ── 孤児ファイルも掃除する ──
 * 投稿の途中で離脱すると、/api/photos で保存されたが
 * observations に紐付かないファイルが残る。1日以上経った未参照ファイルを消す。
 */

import { Pool } from 'pg';
import { readdir, stat, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const RETENTION_DAYS = 14;
/** 孤児と判断するまでの猶予。投稿中のものを消さないため */
const ORPHAN_GRACE_HOURS = 24;

function uploadRoot() {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
}

/** 原寸のパスからサムネイルのパスを導く（lib/photo.ts の thumbPath と同じ規則） */
function thumbPath(p) {
  return p.replace(/\.(webp|jpg)$/, '_t.$1');
}

async function removeBoth(rel) {
  let removed = 0;
  for (const p of [rel, thumbPath(rel)]) {
    try {
      await unlink(path.join(uploadRoot(), p));
      removed++;
    } catch (e) {
      // 既に無いのは正常。前回の途中終了や手動削除でありうる
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return removed;
}

/** uploads 配下の全ファイルを相対パスで列挙する */
async function walk(dir, base = uploadRoot()) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs, base)));
    else if (e.name !== '.gitkeep') out.push(path.relative(base, abs));
  }
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let files = 0;

  // ── 1〜3をまとめて引く。理由も一緒に出して、何が消えたか分かるようにする ──
  const { rows } = await pool.query(
    `SELECT id, photo_path,
            CASE
              WHEN is_hidden        THEN '管理者が伏せた'
              WHEN withdrawn_at IS NOT NULL THEN '投稿者が取り下げた'
              ELSE '期限切れ'
            END AS reason
     FROM observations
     WHERE photo_path IS NOT NULL
       AND (is_hidden
            OR withdrawn_at IS NOT NULL
            OR created_at < now() - ($1 || ' days')::interval)`,
    [RETENTION_DAYS]
  );

  const byReason = {};
  for (const r of rows) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

  process.stdout.write(`削除対象の写真: ${rows.length} 件\n`);
  for (const [k, v] of Object.entries(byReason)) {
    process.stdout.write(`  ${k.padEnd(20)} ${v}\n`);
  }

  if (!DRY) {
    for (const r of rows) {
      // ファイルが先。DBを先に消すと、落ちたときに辿れないファイルが残る
      files += await removeBoth(r.photo_path);
      await pool.query(
        `UPDATE observations SET photo_path = NULL, photo_bytes = NULL WHERE id = $1`,
        [r.id]
      );
    }
  }

  // ── 孤児ファイル。投稿の途中で離脱したものが残る ──
  const all = await walk(uploadRoot());
  const referenced = new Set();
  const { rows: live } = await pool.query(
    `SELECT photo_path FROM observations WHERE photo_path IS NOT NULL`
  );
  for (const r of live) {
    referenced.add(r.photo_path);
    referenced.add(thumbPath(r.photo_path));
  }

  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * 3600_000;
  let orphans = 0;
  for (const rel of all) {
    if (referenced.has(rel)) continue;
    const abs = path.join(uploadRoot(), rel);
    const st = await stat(abs).catch(() => null);
    if (!st || st.mtimeMs > cutoff) continue; // 投稿中かもしれないものは触らない
    orphans++;
    if (!DRY) {
      await unlink(abs);
      files++;
    }
  }
  process.stdout.write(`未参照のファイル: ${orphans} 件\n`);

  // 空になった日付ディレクトリを畳む。放っておくと年月の空箱が増え続ける
  if (!DRY) {
    for (const d of await readdir(uploadRoot()).catch(() => [])) {
      const y = path.join(uploadRoot(), d);
      if (!(await stat(y).catch(() => null))?.isDirectory()) continue;
      for (const m of await readdir(y).catch(() => [])) {
        await rmdir(path.join(y, m)).catch(() => {}); // 空でなければ失敗するだけ
      }
      await rmdir(y).catch(() => {});
    }
  }

  // 残量の報告。上限に近づいていることに気づけるようにする
  const remaining = await walk(uploadRoot());
  let bytes = 0;
  for (const rel of remaining) {
    bytes += (await stat(path.join(uploadRoot(), rel)).catch(() => ({ size: 0 }))).size;
  }
  process.stdout.write(
    DRY
      ? '\n--dry のため何も消していません。\n'
      : `\n消したファイル: ${files}\n`
  );
  process.stdout.write(
    `残っている写真: ${remaining.length} ファイル / ${(bytes / 1024 / 1024).toFixed(1)} MB\n`
  );

  await pool.end();
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
