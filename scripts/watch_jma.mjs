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
/**
 * 通知が実際に届くかを平時に確かめるための試験送信。
 *
 *   node scripts/watch_jma.mjs --test-mail
 *
 * 災害時にしか送らないメールは、届かないことに気づく機会がない。
 * 差出人・件名の符号化・SPF・迷惑メール判定のどれが原因でも、
 * 気づくのは災害の当日になる。年に一度は通しておく。
 */
const TEST_MAIL = process.argv.includes('--test-mail');
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

/**
 * 同じ警報を再び鳴らすまでの間隔。
 *
 * これより短い間隔で見かけ続けている限り「同じ災害の続き」とみなして黙る。
 * 6時間空いてから再び出てきたなら、それは別の一続きとして鳴らしてよい。
 * 短くすると 2026-08-07 の45通に近づき、長くすると翌日の再発達を見落とす。
 */
const QUIET_HOURS = 6;

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

  // 304（変化なし）でも「確認した」ことは残す。
  // これを怠ると checked_at が更新されず、外から見て
  // 「cronが止まっている」のか「気象庁に変化がない」のか区別できない。
  // 平時は何も起きない仕組みなので、動いていることを確認する手段が要る。
  if (res.status === 304) {
    await pool.query(
      `UPDATE jma_feed SET checked_at=now(), failures=0, last_error=NULL WHERE feed=$1`,
      [key]
    );
    return null;
  }
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
 * 警報名から警戒レベルの接頭辞を落とす。
 *
 * 気象庁は同じ発表をＲ０６形式でも配信し、そちらは警報名に警戒レベルが付く。
 *   VPWW53/54 →「大雨警報」
 *   Ｒ０６     →「レベル３大雨警報」
 * 別物として扱うと、同じ大雨警報で二度鳴る。
 */
export const normalizeKind = (k) => k.replace(/^レベル[0-9０-９]+/, '').trim();

/**
 * 気象警報の判定。
 *
 * <Kind><Name>大雨特別警報</Name> の形。名前に「特別警報」を含むものだけを
 * 自動切替の対象にする。コード番号で判定しないのは、読んで分かるものにしたいのと、
 * 番号体系の変更に巻き込まれたくないため。
 *
 * 解除は Status で分かるが、文書全体が現在の発表状況の一覧なので、
 * 「いま出ている特別警報があるか」を見れば足りる。
 *
 * kinds は正規化・重複排除した種別の一覧。鳴らすかどうかの判断はこれを使う。
 * 文書には市町村の数だけ Kind が並ぶ（実測で106〜142個）ので、ここで畳まないと
 * 同じ警報を市町村の数だけ数えることになる。
 */
export function judgeWarning(xml) {
  const kinds = [
    ...new Set(
      [...xml.matchAll(/<Kind>([\s\S]*?)<\/Kind>/g)]
        .map((m) => normalizeKind(tag(m[1], 'Name') ?? ''))
        .filter(Boolean)
    ),
  ];
  const special = kinds.filter((k) => k.includes('特別警報'));
  if (special.length) {
    return {
      action: 'switch',
      hazard: special.some((k) => k.includes('大雨')) ? 'flood' : null,
      label: special.join('・'),
      kinds: special,
    };
  }
  const notify = kinds.filter((k) => /土砂災害警戒情報|大雨警報|洪水警報/.test(k));
  if (notify.length) {
    return { action: 'notify', hazard: null, label: notify.join('・'), kinds: notify };
  }
  return null;
}

/**
 * この警報を鳴らすか。DBを持たない形にして、しきい値の振る舞いを試験できるようにする。
 *
 * prev は jma_warning_state の1行（無ければ null）。
 * 一度も送っていない、または最後に見かけてから QUIET_HOURS 以上空いていれば鳴らす。
 *
 * 「今回の文書に無い＝解除」とは判定しない。Ｒ０６形式は警報種別ごとの
 * 部分的な文書なので、暴風の文書を処理しただけで大雨警報が消えたことになり、
 * 次の発表でまた鳴り出す。見かけなくなって時間が経ったことだけを根拠にする。
 */
export function shouldRing(prev, quietHours = QUIET_HOURS, now = Date.now()) {
  if (!prev || !prev.notified_at) return true;
  return new Date(prev.last_seen).getTime() < now - quietHours * 3600_000;
}

/**
 * まだ鳴らしていない警報だけを返し、見かけたことを記録する。
 *
 * 継続中の警報は last_seen だけが更新され、鳴らない。
 * 新しい種別（洪水警報が加わった等）は記録が無いので鳴る。
 */
export async function unreportedKinds(pool, kinds) {
  const fresh = [];
  for (const kind of kinds) {
    const { rows } = await pool.query(
      `SELECT last_seen, notified_at FROM jma_warning_state WHERE kind = $1`,
      [kind]
    );
    const rings = shouldRing(rows[0] ?? null);
    if (rings) fresh.push(kind);
    await pool.query(
      `INSERT INTO jma_warning_state (kind, notified_at)
       VALUES ($1, CASE WHEN $2 THEN now() END)
       ON CONFLICT (kind) DO UPDATE
         SET last_seen   = now(),
             notified_at = CASE WHEN $2 THEN now() ELSE jma_warning_state.notified_at END`,
      [kind, rings]
    );
  }
  return fresh;
}

/**
 * メールで知らせる。postfix が動いているので sendmail に流す。
 *
 * ── 件名は必ず符号化する ──
 * 日本語をそのまま渡すと postfix が SMTPUTF8 を要求し、
 * 対応していない受信側（さくら等）で bounce する。
 * RFC 2047 の Base64 にしておけば ASCII だけで送れる。
 *
 * ── 差出人を明示する ──
 * 既定では deploy-yui@<ホスト名> になる。ホスト名がIPアドレス由来のままだと、
 * 受信側で迷惑メール扱いされやすい。運用しているドメインを名乗る。
 * あわせて yui-yamagata.com の SPF にこのサーバを入れておくこと
 * （docs/cloudflare.md 参照）。入れないと SPF 不一致で弾かれうる。
 *
 * 災害時にしか送らないメールなので、届かないことに気づく機会がない。
 * 平時のうちに実際に届くところまで確かめる。
 */
function notify(subject, body) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to || DRY) return;
  const from = process.env.NOTIFY_FROM ?? 'noreply@yui-yamagata.com';
  const mail = [
    `From: =?UTF-8?B?${Buffer.from('やまがた結（ゆい）').toString('base64')}?= <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\n');
  try {
    const p = spawn('/usr/sbin/sendmail', ['-t', '-f', from], { stdio: ['pipe', 'ignore', 'ignore'] });
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
  if (TEST_MAIL) {
    const to = process.env.NOTIFY_EMAIL;
    if (!to) { process.stderr.write('NOTIFY_EMAIL が未設定です\n'); process.exit(1); }
    notify(
      '【やまがた結】通知の試験送信',
      '災害モードの自動切替で使う通知経路の確認です。\n\n' +
        'このメールが届いていれば、山形県で震度5弱以上または特別警報が\n' +
        '発表されたとき、同じ経路で連絡が届きます。\n\n' +
        '迷惑メールフォルダに入っていた場合は、受信できるよう設定してください。\n' +
        '災害時にこの通知を見落とすと、切替に気づけません。\n'
    );
    process.stdout.write(`  ${to} へ試験送信しました。届いたか確認してください\n`);
    return;
  }

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
        // 地震（震度4）は発表ごとに別の地震なので、そのまま鳴らす。
        // 気象警報は同じ警報が何度も出し直されるので、種別ごとに一度だけにする。
        const fresh =
          key === 'eqvol' || DRY ? verdict.kinds ?? [verdict.label]
                                 : await unreportedKinds(pool, verdict.kinds);
        if (fresh.length) {
          const label = fresh.join('・');
          process.stdout.write(`    通知のみ: ${label}\n`);
          notify(
            `【やまがた結】${PREF}で${label}`,
            `${label}が発表されました。\n\n` +
              `自動切替のしきい値（震度5弱以上・特別警報）には達していません。\n` +
              `災害モードにするかは判断してください。\n` +
              `https://yui-yamagata.com/admin\n`
          );
          action = 'notified';
        } else {
          // 同じ警報の出し直し。鳴らさないが、握り潰したことは残す
          process.stdout.write(`    通知済みのため送らない: ${verdict.label}\n`);
          action = 'suppressed';
        }
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
    // 30日見かけていない警報は、次に出たら鳴らしてよい。行を残す理由がない
    await pool.query(
      `DELETE FROM jma_warning_state WHERE last_seen < now() - interval '30 days'`
    );
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
