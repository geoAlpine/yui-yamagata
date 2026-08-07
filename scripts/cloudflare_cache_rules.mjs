/**
 * Cloudflare の Cache Rules に「GET /api/spots をキャッシュする」規則を入れる。
 *
 *   export CLOUDFLARE_API_TOKEN=...            # 下の「トークン」参照
 *   node scripts/cloudflare_cache_rules.mjs           # 下見（既定）
 *   node scripts/cloudflare_cache_rules.mjs --apply   # 反映
 *
 * ── なぜ要るか ──
 * `/api/` は Cloudflare 側で Bypass にしてある（docs/cloudflare.md ルール1）。
 * アプリが s-maxage を返すようにしても、この Bypass に上書きされるので効かない。
 * GET /api/spots だけを抜くルールを足す必要がある。
 *
 * ★★ Cache Rules は「最初に一致したものが勝つ」ではない ★★
 * 一致したルールが上から順にすべて適用され、**後のルールが前を上書きする**。
 * ファイアウォールのルールとは逆で、ここを取り違えて半日溶かした。
 * したがって例外ルールは Bypass より**後ろ**（末尾）に置く。先頭に置くと、
 * あとから来る Bypass に毎回上書きされ、cf-cache-status は DYNAMIC のまま
 * 変わらない。しかも「ルールが一致していない」ように見えるので気づきにくい。
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
    // ★ここを省略してはいけない。
    // 「Eligible for cache」だけ立てても、edge_ttl が無いと Cloudflare は
    // 既定の判断（拡張子ベース）に戻り、JSON は対象外になって DYNAMIC のままになる。
    // 実際にこれで一度ハマった。既存の cache-html ルールと同じ指定を明示する。
    //
    // bypass_by_default = 「cache-control があればそれに従い、無ければキャッシュしない」。
    // override_origin にはしない。アプリが no-store と言ったら従うべきで、
    // その原則が最後の砦になっている（app/api/spots/route.ts）。
    edge_ttl: { mode: 'bypass_by_default' },
  },
  enabled: true,
};

/** 期待する edge_ttl。既存ルールがこれと違えば直す */
const WANT_TTL_MODE = RULE.action_parameters.edge_ttl.mode;

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

function show(rules, verbose = false) {
  rules.forEach((r, i) => {
    const cache =
      r.action_parameters?.cache === false
        ? 'Bypass'
        : r.action_parameters?.cache === true
          ? `Cache (edge_ttl=${r.action_parameters?.edge_ttl?.mode ?? '既定'})`
          : r.action;
    const mark = mentionsApiSpots(r) ? ' ←/api/spots を対象にしているルール' : '';
    process.stdout.write(`  ${String(i + 1).padStart(2)}. [${r.enabled ? '有効' : '無効'}] ${cache}${mark}\n`);
    process.stdout.write(`      名前: ${r.description || '(説明なし)'}\n`);
    process.stdout.write(`      条件: ${r.expression}\n`);
    if (verbose) {
      // 画面では読み取れない設定（cache_key・serve_stale・browser_ttl など）まで出す。
      // 「ちゃんと設定したのに効かない」ときは、たいていここに答えがある。
      process.stdout.write(
        `      設定: ${JSON.stringify(r.action_parameters ?? {}, null, 0)}\n`
      );
    }
  });
}

/** そのルールが /api/spots を巻き込むか。名前ではなく条件式で見る */
function mentionsApiSpots(r) {
  return (r.expression ?? '').includes('/api/spots');
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
  show(rules, !APPLY);

  /*
    「設定したのに効かない」の切り分け。
    Cloudflare は先に当たったルールだけを適用するので、/api/spots を対象にした
    ルールがあっても、その上に Bypass が居れば負ける。順序を明示的に見る。
  */
  const idx = rules.findIndex(mentionsApiSpots);
  const blocker = rules.findIndex(
    (r) => r.action_parameters?.cache === false && (r.expression ?? '').includes('/api/')
  );
  let needsTtlFix = false;
  if (idx >= 0) {
    process.stdout.write(`\n/api/spots を対象にしたルールは ${idx + 1} 番目にあります。\n`);
    if (!rules[idx].enabled) {
      process.stdout.write('  ★無効になっています。有効にしてください。\n');
    }
    if (rules[idx].action_parameters?.cache !== true) {
      process.stdout.write('  ★Cache eligibility が「Eligible for cache」になっていません。\n');
    }
    const mode = rules[idx].action_parameters?.edge_ttl?.mode;
    if (mode !== WANT_TTL_MODE) {
      needsTtlFix = true;
      process.stdout.write(
        `  ★Edge TTL が ${mode ?? '未設定'} です。${WANT_TTL_MODE} にする必要があります。\n` +
          '    未設定だと Cloudflare は既定の判断（拡張子ベース）に戻り、JSON はキャッシュされません。\n'
      );
    }
    // 後ろに Bypass が居ると上書きされる。前に居るぶんには問題ない
    if (blocker > idx) {
      process.stdout.write(
        `  ★${blocker + 1} 番目の Bypass（/api/）が後から上書きするため、このルールは効きません。\n` +
          '    Cache Rules は後のルールが勝つので、この例外ルールを末尾へ移動してください。\n'
      );
    }
  }

  // 既存ルールの Edge TTL だけを直す。条件式や位置には触らない
  if (idx >= 0 && needsTtlFix) {
    if (!APPLY) {
      process.stdout.write('\n--apply を付けると、この Edge TTL を直します。\n');
      return;
    }
    const target = rules[idx];
    const updated = await cf(`/zones/${zone.id}/rulesets/${phase.id}/rules/${target.id}`, {
      method: 'PATCH',
      // action_parameters だけを送ると「action is required」で 400 になる。
      // 既存の値をそのまま添えて、edge_ttl だけ差し替える。
      body: JSON.stringify({
        action: target.action,
        expression: target.expression,
        description: target.description,
        enabled: target.enabled,
        action_parameters: { ...target.action_parameters, edge_ttl: { mode: WANT_TTL_MODE } },
      }),
    });
    process.stdout.write('\nEdge TTL を直しました。\n');
    show(updated.rules ?? [], false);
    process.stdout.write(
      `\n数十秒おいてから確認してください:\n  curl -sI "https://${zone.name}/api/spots?categories=water&lat=38.255&lng=140.340" | grep -i cf-cache-status\n`
    );
    return;
  }

  // 先に確認する。既に壊れているなら、その上に足しても意味がない
  const missing = MUST_BYPASS.filter((p) => !bypassesPath(rules, p));
  if (missing.length) {
    process.stdout.write(
      `\n★${missing.join(' と ')} の Bypass が見当たりません。` +
        'キャッシュすると他人の情報が配られます。先にそちらを直してください。\n'
    );
    process.exit(1);
  }

  /*
    重複を作らない。名前ではなく条件式で判定する。
    画面で作ったルールは名前が違うので、名前で見ると同じ条件のものを二重に足してしまう。
  */
  if (idx >= 0) {
    process.stdout.write('\n/api/spots を対象にしたルールが既にあるため、追加しません。\n');
    process.stdout.write('上の診断で ★ が出ていれば、そこが原因です。画面で直すか、当該ルールを消してから再実行してください。\n');
    return;
  }

  process.stdout.write('\n追加するルール（末尾に入れる。後のルールが勝つため）:\n');
  process.stdout.write(`  ${RULE.description}\n  ${RULE.expression}\n`);
  process.stdout.write(`  Cache: 有効 / edge_ttl: ${RULE.action_parameters.edge_ttl.mode}\n`);

  if (!APPLY) {
    process.stdout.write('\n--apply が無いので反映しませんでした。\n');
    return;
  }

  // 全体を PUT で置き換えると、一手で他のルールを消せてしまう。
  // 1件だけ足す API を使う。位置は指定しない（末尾に付く）。
  // 末尾でなければならない理由は冒頭のコメントを参照。
  const created = await cf(`/zones/${zone.id}/rulesets/${phase.id}/rules`, {
    method: 'POST',
    body: JSON.stringify(RULE),
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
  if (after[after.length - 1]?.description !== RULE_TAG) {
    process.stdout.write('\n★追加したルールが末尾にありません。後続の Bypass に上書きされて効きません。\n');
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
