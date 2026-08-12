import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { unreportedKinds } from '../scripts/watch_jma.mjs';

/**
 * 警報通知の重複止めを、実際のSQLごと確かめる。
 *
 * 2026-08-07 14:52 〜 08-08 17:00 の大雨警報で45通のメールが届いた。
 * 警報はその間ずっと継続しており、新しい災害が45回起きたわけではない。
 * ここが壊れると、いちばん人手が足りない災害の最中に、
 * 受信箱が同じ警報で埋まって肝心の一通が埋もれる。
 *
 * 判定そのもの（レベル表記の正規化・種別の畳み込み）は jma.test.ts に置き、
 * ここではDBを跨いだ「継続中は鳴らない」だけを見る。
 *
 * CIには postgres が居るので走る。手元にDBが無ければ skip する。
 * npm test はスキーマを流す前に走るので、必要な表はここで作る。
 */
let cached: Pool | null | undefined;

async function db(): Promise<Pool | null> {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.env.DATABASE_URL) {
    const p = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await p.query(
        readFileSync(new URL('../db/016_jma_warning_state.sql', import.meta.url), 'utf8')
      );
      await p.query('TRUNCATE jma_warning_state');
      cached = p;
    } catch {
      await p.end().catch(() => {});
    }
  }
  return cached;
}

const SKIP = 'DATABASE_URL に繋がらない（CIでは走る）';

after(async () => {
  await cached?.end();
});

test('★45通の再現: 同じ警報が続く限り、鳴るのは最初の一度だけ', async (t) => {
  const pool = await db();
  if (!pool) return t.skip(SKIP);
  await pool.query('TRUNCATE jma_warning_state');

  // 実際の並び。1回の発表が3つの文書で届き（VPWW53 / VPWW54 / Ｒ０６）、
  // それが17回出し直された。正規化後はどれも「大雨警報」になる。
  const 発表回数 = 17;
  const 形式 = 3;
  let メール = 0;
  for (let r = 0; r < 発表回数; r++) {
    for (let f = 0; f < 形式; f++) {
      const fresh = await unreportedKinds(pool, ['大雨警報']);
      if (fresh.length) メール++;
    }
  }
  assert.equal(メール, 1, `${発表回数 * 形式}件の文書で ${メール}通 送られた`);
});

test('継続中でも、種別が増えたらその分だけ鳴る', async (t) => {
  const pool = await db();
  if (!pool) return t.skip(SKIP);
  await pool.query('TRUNCATE jma_warning_state');

  assert.deepEqual(await unreportedKinds(pool, ['大雨警報']), ['大雨警報']);
  // 大雨警報の最中に洪水警報が加わるのは状況の悪化。ここを黙らせてはいけない
  assert.deepEqual(await unreportedKinds(pool, ['大雨警報', '洪水警報']), ['洪水警報']);
  // 増えた分を鳴らしたあとは、また黙る
  assert.deepEqual(await unreportedKinds(pool, ['大雨警報', '洪水警報']), []);
});

test('収まってから間が空けば、次に出たときは鳴る', async (t) => {
  const pool = await db();
  if (!pool) return t.skip(SKIP);
  await pool.query('TRUNCATE jma_warning_state');

  await unreportedKinds(pool, ['大雨警報']);
  await pool.query(`UPDATE jma_warning_state SET last_seen = now() - interval '7 hours'`);
  assert.deepEqual(await unreportedKinds(pool, ['大雨警報']), ['大雨警報'], '7時間空けば鳴る');
});

test('★部分的な文書を処理しても、他の警報が鳴り直さない', async (t) => {
  // Ｒ０６形式は警報種別ごとに分かれている。暴風の文書には大雨のことが書いていない。
  // 「この文書に無い＝解除」と判定すると、暴風の文書を1つ挟むだけで
  // 大雨警報が消えたことになり、次の発表でまた鳴り出す。
  const pool = await db();
  if (!pool) return t.skip(SKIP);
  await pool.query('TRUNCATE jma_warning_state');

  assert.deepEqual(await unreportedKinds(pool, ['大雨警報']), ['大雨警報']);
  await unreportedKinds(pool, ['洪水警報']); // 大雨を含まない別種別の文書
  assert.deepEqual(await unreportedKinds(pool, ['大雨警報']), [], '大雨警報が鳴り直している');
});
