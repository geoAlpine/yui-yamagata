import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCategory } from '@/lib/categories';
import {
  findSpots, findNearbySpots, insertSpot, recentSpotCountByIp,
} from '@/lib/queries';
import { getOrIssueIdentity, attachIdentity, clientIp } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * 位置情報が取れたときに「近い順」で取り直すための経路。
 *
 * ── CDNに載せる ──
 * HTMLは next.config.ts で30秒キャッシュしているが、この経路は no-store だった。
 * 位置情報を許可した人の閲覧ごとにVPSまで届くので、CDNを通らない読み取りとしては
 * ここが最大になる。同居する商用サイトを巻き込まないためにも落としておきたい。
 *
 * 載せてよい根拠:
 *   - 返すのは公開情報だけ。利用者ごとに変わる要素がない
 *   - Set-Cookie を返さない。匿名IDの発行は POST 側だけ（lib/identity.ts）
 *   - カテゴリのTTLは2〜24時間なので、30秒の遅れは無視できる
 *
 * 呼び出し側（components/SpotList.tsx）が座標を約100mに丸めて送る。
 * CDNのキャッシュキーはURLなので、丸めないと利用者ごとに別物になり
 * 1件もヒットしない。
 *
 * ★Cloudflare 側の Cache Rules で `/api/` を Bypass にしている。
 *   このヘッダを効かせるには、GET /api/spots だけを除外する必要がある。
 *   手順は docs/cloudflare.md「手順5: キャッシュルール」を参照。
 */
const CDN_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=120';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const categories = (url.searchParams.get('categories') ?? '')
    .split(',')
    .filter(Boolean);

  if (!categories.length) {
    return NextResponse.json({ spots: [] }, { headers: { 'cache-control': CDN_CACHE } });
  }

  // 山形県からあまりに離れた座標は無視して、全件を距離順に並べる意味のない計算を避ける
  const validLoc =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  // 災害種別は利用者が選ぶ。渡し忘れると位置情報で取り直した瞬間に
  // 絞り込みが外れ、「距離順にしたら洪水非対応の避難場所が混ざる」
  // という最悪の形になる。サーバ描画と同じ条件を必ず通す。
  const hazard = url.searchParams.get('hz') || null;
  // モードは引かない。カテゴリはクライアントが送ってくるものをそのまま使う。
  // 以前はここで getMode() を呼んで findSpots に渡していたが、findSpots は
  // それを見ておらず、閲覧のたびに site_state を1回引くだけの無駄になっていた。
  const spots = await findSpots({
    categories,
    lat: validLoc ? lat : undefined,
    lng: validLoc ? lng : undefined,
    hazard,
    limit: 50,
  });

  return NextResponse.json(
    { spots },
    { headers: { 'cache-control': CDN_CACHE } }
  );
}

/**
 * 場所の追加。
 *
 * 重複登録の抑止がこの経路の主目的。同じ場所が二重に立つと観測が分散し、
 * 「場所に観測が積み重なる」という設計の利点がそのまま失われる。
 * 近隣に同カテゴリの場所があれば 409 で候補を返し、利用者に選ばせる。
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const name = str(body.name, 40);
  const category = str(body.category, 30);
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!name || !getCategory(category)) {
    return NextResponse.json({ error: '名前と種類は必須です' }, { status: 400 });
  }
  // 山形県を大きく囲む範囲。県外の座標を弾いて、いたずら登録を減らす
  const inYamagata = lat > 37.7 && lat < 39.0 && lng > 139.4 && lng < 140.7;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inYamagata) {
    return NextResponse.json(
      { error: '位置が取得できていないか、山形県の範囲外です' },
      { status: 400 }
    );
  }

  const identity = await getOrIssueIdentity();
  const ip = clientIp(req);

  if (ip !== 'unknown' && (await recentSpotCountByIp(ip, 30)) >= 10) {
    return NextResponse.json(
      { error: '短時間に場所を登録しすぎています。少し時間をおいてください。' },
      { status: 429 }
    );
  }

  if (body.force !== true) {
    const nearby = await findNearbySpots(lat, lng, category, 120);
    if (nearby.length > 0) {
      return attachIdentity(
        NextResponse.json({ error: 'nearby', nearby }, { status: 409 }),
        identity
      );
    }
  }

  const row = await insertSpot({
    name,
    category,
    lat,
    lng,
    address: str(body.address, 80) || null,
    municipality: str(body.municipality, 20) || null,
    note: str(body.note, 60) || null,
    ip,
  });

  revalidatePath('/');
  return attachIdentity(NextResponse.json({ ok: true, id: row.id }), identity);
}
