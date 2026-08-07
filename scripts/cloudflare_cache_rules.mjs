/**
 * Cloudflare の Cache Rules に「GET /api/spots をキャッシュする」規則を入れる。
 *
 *   export CLOUDFLARE_API_TOKEN=...            # 下の「トークン」参照
 *   node scripts/cloudflare_cache_rules.mjs           # 下見（既定）
 *   node scripts/cloudflare_cache_rules.mjs --apply   # 反映
 *
 * ── なぜ要るか ──
 * `/api/` は Cloudflare 側で Bypass にしてある（docs/cloudflare.md ルール1）。
 * アプリが s-maxage を返すようにしても、この Bypass が先に当たるので効かない。
 * GET /api/spots だけを抜くルールを、Bypass より上に置く必要がある。
 *
 * ── なぜ既定が下見なのか ──
 * 他のスクリプトは既定で書き込み、--dry で下見だが、これは逆にしてある。
 * 対象が本番のCDNで、間違えたときに戻すのが取り込みより難しいため。
 *
 * ── 壊してはいけないもの ──
 * `/admin` と `/mine` の Bypass。これが消えると管理画面や投稿者ごとの一覧が
 * キャッシュされ、他人の情報が配られる。ルールセット全体を PUT で置き換えると
 * 一手で消せてしまうので、このスクリプトは**1件だけ追加する API** を使い、
 * さらに追加前後で Bypass の存在を確認する。
 *
 * ── トークン ──
 * ダッシュボード → My Profile → API Tokens → Create Token → Custom token
 *   Permissions: Zone / Cache Rules / Edit
 *               Zone / Zone       / Read      （ゾーンIDの解決に要る）
 *   Zone Resources: Include / Specific zone / yui-yamagata.com
 * 権限はこの2つで足りる。Global API Key は使わない（全権限になる）。
 */

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_NAME = process.env.CLOUDFLARE_ZONE ?? 'yui-yamagata.com';
const APPLY = process.argv.includes('--apply');

const API = 'https://api.cloudflare.com/client/v4';

/** このスクリプトが管理するルール。description で自分の入れた分を見分ける */
const RULE_TAG = 'yui: cache GET /api/spots';

const RULE = {
  description: RULE_TAG,
  // POST /api/spots（場所の追加）を巻き込まないこと。
  // 巻き込むと匿名IDを発行する応答がキャッシュされ、他人のIDが配られる。
  expression: '(http.request.uri.path eq "/api/spots" and http.request.method eq "GET")',
  action: 'set_cache_settings',
  action_parameters: {
    cache: true,
    // Override にしない。どれだけ持ってよいかを知っているのはアプリのほうで、
    // app/api/spots/route.ts が s-maxage=30, stale-while-revalidate=120 を返す。
    edge_ttl: { mode: 'respect_origin' },
  },
  enabled: true,
};

/** 消えていてはいけない Bypass。追加の前後で確認する */
const MUST_BYPASS = ['/admin', '/mine'];

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join(' / ');
    throw new Error(`Cloudflare ${res.status}: ${msg || JSON.stringify(body).slice(0, 200)}`);
  }
  return body.result;
}

/** ルール一覧から、指定パスを Bypass しているものを探す */
function bypassesPath(rules, path) {
  return rules.some(
    (r) =>
      r.action === 'set_cache_settings' &&
      r.action_parameters?.cache === false &&
      (r.expression ?? '').includes(path)
  );
}

function show(rules) {
  rules.forEach((r, i) => {
    const cache =
      r.action_parameters?.cache === false
        ? 'Bypass'
        : r.action_parameters?.cache === true
          ? `Cache (edge_ttl=${r.action_parameters?.edge_ttl?.mode ?? '既定'})`
          : r.action;
    const mark = r.description === RULE_TAG ? ' ←このスクリプトの分' : '';
    process.stdout.write(`  ${String(i + 1).padStart(2)}. [${r.enabled ? '有効' : '無効'}] ${cache}${mark}\n`);
    process.stdout.write(`      ${r.description || '(説明なし)'}\n`);
    process.stdout.write(`      ${r.expression}\n`);
  });
}

async function main() {
  if (!TOKEN) {
    process.stderr.write(
      'CLOUDFLARE_API_TOKEN が未設定です。作り方はこのファイル冒頭のコメントを参照してください。\n'
    );
    process.exit(2);
  }

  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  if (!zones.length) throw new Error(`ゾーンが見つかりません: ${ZONE_NAME}`);
  const zone = zones[0];
  process.stdout.write(`ゾーン: ${zone.name} (${zone.id})\n\n`);

  const phase = await cf(`/zones/${zone.id}/rulesets/phases/http_request_cache_settings/entrypoint`);
  const rules = phase.rules ?? [];

  process.stdout.write(`現在の Cache Rules（${rules.length}件、上から順に評価）:\n`);
  show(rules);

  // 先に確認する。既に壊れているなら、その上に足しても意味がない
  const missing = MUST_BYPASS.filter((p) => !bypassesPath(rules, p));
  if (missing.length) {
    process.stdout.write(
      `\n★${missing.join(' と ')} の Bypass が見当たりません。` +
        'キャッシュすると他人の情報が配られます。先にそちらを直してください。\n'
    );
    process.exit(1);
  }

  const existing = rules.find((r) => r.description === RULE_TAG);
  if (existing) {
    process.stdout.write('\nこのスクリプトのルールは既に入っています。何もしません。\n');
    process.stdout.write('内容を変えたい場合は、ダッシュボードで当該ルールを削除してから再実行してください。\n');
    return;
  }

  process.stdout.write('\n追加するルール（先頭に入れる。Bypass より先に当てるため）:\n');
  process.stdout.write(`  ${RULE.description}\n  ${RULE.expression}\n`);
  process.stdout.write(`  Cache: 有効 / edge_ttl: ${RULE.action_parameters.edge_ttl.mode}\n`);

  if (!APPLY) {
    process.stdout.write('\n--apply が無いので反映しませんでした。\n');
    return;
  }

  // 全体を PUT で置き換えると、一手で他のルールを消せてしまう。
  // 1件だけ足す API を使い、位置を先頭に指定する。
  const first = rules[0];
  const created = await cf(`/zones/${zone.id}/rulesets/${phase.id}/rules`, {
    method: 'POST',
    body: JSON.stringify(first ? { ...RULE, position: { before: first.id } } : RULE),
  });

  const after = created.rules ?? [];
  process.stdout.write(`\n反映後（${after.length}件）:\n`);
  show(after);

  // 足したことで他が消えていないか、もう一度確かめる
  const broke = MUST_BYPASS.filter((p) => !bypassesPath(after, p));
  if (broke.length) {
    process.stdout.write(`\n★${broke.join(' と ')} の Bypass が消えました。ただちに戻してください。\n`);
    process.exit(1);
  }
  if (after[0]?.description !== RULE_TAG) {
    process.stdout.write('\n★追加したルールが先頭にありません。Bypass が先に当たるため効きません。\n');
    process.exit(1);
  }

  process.stdout.write('\n完了。数十秒おいてから確認してください:\n');
  process.stdout.write(
    `  curl -sI "https://${zone.name}/api/spots?categories=water&lat=38.255&lng=140.340" | grep -i cf-cache-status\n`
  );
  process.stdout.write('  1回目は MISS、2回目に HIT になれば効いています。\n');
}

main().catch((e) => {
  process.stderr.write(String(e?.message ?? e) + '\n');
  process.exit(1);
});
