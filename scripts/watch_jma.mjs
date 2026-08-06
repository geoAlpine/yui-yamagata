/**
 * 気象庁の防災情報を毎分確認し、災害モードを自動で切り替える。
 *
 *   node --env-file=.env.local scripts/watch_jma.mjs [--dry] [--once]
 *
 * ── なぜ自動化するか ──
 * 当初は「自動切替はしない、誤爆の信頼失墜が回復不能だから」としていた。
 * 懸念自体は正しいが、対称に考えていた。
 *
 *   誤って切り替える → 「大げさだな」と思われる。訂正できる
 *   切り替え損ねる   → 災害時に平時モードのまま。取り返しがつかない
 *
 * 深夜に地震が起きたとき、運営者が寝ていたら、あるいは運営者自身が
 * 被災していたら、誰も切り替えられない。災害のために作ったサイトが
 * 災害時に平時モードのままになる。これがいちばん避けたい失敗。
 *
 * ── 戻すのは手動だけ ──
 * 自動では絶対に戻さない。非対称にするのが要点。
 *
 * 災害モードが本当に必要なのは発災の数時間後から数日後。気象庁の情報が
 * 落ち着いた時点で戻すと、断水や物資不足が続いているいちばん必要な時期に
 * 平時モードへ戻ってしまう。「もう大丈夫」を機械に判断させない。
 *
 * 戻すのは、状況が収まったことを人が確かめてから /admin で行う。
 *
 * ── 気象庁が落ちていたら何もしない ──
 * 取得に失敗しても現状維持。勝手に平時へ戻さない。
 * 外部サービスの障害が、こちらの表示を壊してはいけない。
 */

import { Pool } from 'pg';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DRY = process.argv.includes('--dry');
const PREF = '山形県';

const FEEDS = {
  // 地震・火山。震度速報は地震の約1分半後に出る
  eqvol: 'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml',
  // 気象特別警報・警報・注意報
  extra: 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml',
};

/** 自動で災害モードにする震度。5弱以上。XMLでは 5弱="5-" 5強="5+" */
const SWITCH_INTENSITIES = new Set(['5-', '5+', '6-', '6+', '7']);
/** 通知だけする震度 */
const NOTIFY_INTENSITIES = new Set(['4']);

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`));
  return m ? m[1] : null;
};
const tags = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);

/** 条件付きGET。変化がなければ304で済ませる */
async function fetchFeed(pool, key) {
  const { rows } = await pool.query(
    `SELECT etag, last_modified FROM jma_feed WHERE feed = $1`,
    [key]
  );
  const prev = rows[0] ?? {};
  const headers = { 'user-agent': 'yui-yamagata-bousai/1.0 (+https://yui-yamagata.com)' };
  if (prev.etag) headers['if-none-match'] = prev.etag;
  if (prev.last_modified) headers['if-modified-since'] = prev.last_modified;

  const res = await fetch(FEEDS[key], { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);

  const body = await res.text();
  await pool.query(
    `UPDATE jma_feed SET etag=$2, last_modified=$3, checked_at=now(), failures=0, last_error=NULL
     WHERE feed=$1`,
    [key, res.headers.get('etag'), res.headers.get('last-modified')]
  );
  return body;
}

/** Atomフィードから、まだ処理していない山形県関係のentryを取り出す */
async function newEntries(pool, xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = tag(e, 'id');
    const title = tag(e, 'title') ?? '';
    const content = (e.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? '';
    if (!id) continue;
    // 気象警報は content に【山形県…】と入るので、本文を取りに行かずに絞れる。
    // 地震は全国どこでも山形が揺れうるので、種別で拾って本文で判定する。
    const quake = /震度速報|震源・震度/.test(title);
    if (!quake && !content.includes(PREF)) continue;
    const { rowCount } = await pool.query(`SELECT 1 FROM jma_seen WHERE event_id = $1`, [id]);
    if (rowCount) continue;
    out.push({ id, title, content, published: tag(e, 'updated') ?? new Date().toISOString() });
  }
  return out;
}

async function fetchDoc(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'yui-yamagata-bousai/1.0 (+https://yui-yamagata.com)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`doc: HTTP ${res.status}`);
  return res.text();
}

/**
 * 地震の判定。山形県の最大震度を見る。
 *
 * <Pref><Name>山形県</Name><Code>06</Code><MaxInt>5-</MaxInt> の形で入る。
 * 県のブロックを切り出してから MaxInt を読む。全国の MaxInt を拾うと、
 * 熊本の地震で山形が災害モードになる。
 */
export function judgeQuake(xml) {
  for (const m of xml.matchAll(/<Pref>([\s\S]*?)<\/Pref>/g)) {
    if (tag(m[1], 'Name') !== PREF) continue;
    const max = tag(m[1], 'MaxInt');
    if (!max) continue;
    if (SWITCH_INTENSITIES.has(max)) {
      return { action: 'switch', hazard: 'earthquake', label: `最大震度${jp(max)}` };
    }
    if (NOTIFY_INTENSITIES.has(max)) {
      return { action: 'notify', hazard: null, label: `最大震度${jp(max)}` };
    }
  }
  return null;
}
const jp = (i) => i.replace('-', '弱').replace('+', '強');

/**
 * 気象警報の判定。
 *
 * <Kind><Name>大雨特別警報</Name> の形。名前に「特別警報」を含むものだけを
 * 自動切替の対象にする。コード番号で判定しないのは、読んで分かるものにしたいのと、
 * 番号体系の変更に巻き込まれたくないため。
 *
 * 解除は Status で分かるが、文書全体が現在の発表状況の一覧なので、
 * 「いま出ている特別警報があるか」を見れば足りる。
 */
export function judgeWarning(xml) {
  const kinds = [...xml.matchAll(/<Kind>([\s\S]*?)<\/Kind>/g)].map((m) => tag(m[1], 'Name') ?? '');
  const special = kinds.filter((k) => k.includes('特別警報'));
  if (special.length) {
    const uniq = [...new Set(special)];
    return {
      action: 'switch',
      hazard: uniq.some((k) => k.includes('大雨')) ? 'flood' : null,
      label: uniq.join('・'),
    };
  }
  const notify = kinds.filter((k) => /土砂災害警戒情報|大雨警報|洪水警報/.test(k));
  if (notify.length) {
    return { action: 'notify', hazard: null, label: [...new Set(notify)].join('・') };
  }
  return null;
}

/** メールで知らせる。postfix が動いているので sendmail に流す */
function notify(subject, body) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to || DRY) return;
  const mail = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\n');
  try {
    const p = spawn('/usr/sbin/sendmail', ['-t'], { stdio: ['pipe', 'ignore', 'ignore'] });
    p.stdin.write(mail);
    p.stdin.end();
  } catch {
    // 通知が送れなくても本体の判断は続ける。ここで落ちるほうが害が大きい
  }
}

async function switchToDisaster(pool, reason, hazard) {
  const { rows } = await pool.query(`SELECT mode FROM site_state WHERE id = true`);
  if (rows[0]?.mode === 'disaster') {
    process.stdout.write('  既に災害モード。何もしない\n');
    return false;
  }
  process.stdout.write(`  ★災害モードへ切り替え: ${reason}\n`);
  if (DRY) return true;

  await pool.query(
    `UPDATE site_state
     SET mode='disaster', hazard=$2, auto_switched_at=now(), auto_reason=$1, updated_at=now()
     WHERE id = true`,
    [reason, hazard]
  );
  notify(
    '【やまがた結】災害モードに切り替えました',
    `${reason}\n\n` +
      `気象庁の発表を検知し、自動で災害モードに切り替えました。\n` +
      `https://yui-yamagata.com/admin\n\n` +
      `平時（そなえ）に戻すのは手動です。自動では戻しません。\n` +
      `状況が収まったことを確かめてから、管理画面で戻してください。\n`
  );
  return true;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  for (const key of Object.keys(FEEDS)) {
    let feed;
    try {
      feed = await fetchFeed(pool, key);
    } catch (e) {
      // 気象庁が落ちていても現状維持。ここで例外を投げると平時判定にも進まない
      await pool.query(
        `UPDATE jma_feed SET failures = failures + 1, last_error = $2, checked_at = now()
         WHERE feed = $1`,
        [key, String(e).slice(0, 200)]
      );
      process.stderr.write(`  ${key}: 取得失敗 ${e}\n`);
      continue;
    }
    if (!feed) { process.stdout.write(`  ${key}: 変化なし(304)\n`); continue; }

    const entries = await newEntries(pool, feed);
    process.stdout.write(`  ${key}: 新着 ${entries.length} 件\n`);

    for (const e of entries) {
      let doc;
      try {
        doc = await fetchDoc(e.id);
      } catch (err) {
        process.stderr.write(`    本文取得に失敗: ${err}\n`);
        continue; // jma_seen に入れない。次回もう一度試す
      }
      const verdict = key === 'eqvol' ? judgeQuake(doc) : judgeWarning(doc);

      let action = 'ignored';
      if (verdict?.action === 'switch') {
        const when = new Date(e.published).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const reason = `${PREF}で${verdict.label}（気象庁 ${when} 発表）`;
        await switchToDisaster(pool, reason, verdict.hazard);
        action = 'switched';
      } else if (verdict?.action === 'notify') {
        process.stdout.write(`    通知のみ: ${verdict.label}\n`);
        notify(
          `【やまがた結】${PREF}で${verdict.label}`,
          `${verdict.label}が発表されました。\n\n` +
            `自動切替のしきい値（震度5弱以上・特別警報）には達していません。\n` +
            `災害モードにするかは判断してください。\n` +
            `https://yui-yamagata.com/admin\n`
        );
        action = 'notified';
      }

      if (!DRY) {
        await pool.query(
          `INSERT INTO jma_seen (event_id, title, published, action)
           VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING`,
          [e.id, e.title.slice(0, 120), e.published, action]
        );
      }
    }
  }

  if (!DRY) {
    await pool.query(`DELETE FROM jma_seen WHERE seen_at < now() - interval '30 days'`);
  }
  await pool.end();
}

// テストから判定関数だけを取り込めるようにする。
// これが無いと、import しただけでDBに繋ぎに行き本体が動く。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(String(e?.stack ?? e) + '\n');
    process.exit(1);
  });
}
