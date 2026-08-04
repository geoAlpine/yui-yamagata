import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * 匿名の投稿者ID。
 *
 * ユーザー登録は求めない。被災地でアカウント作成を挟んだ瞬間に、
 * 使われるサイトではなくなる（イマココナビも匿名認証のみで、
 * 自分でアカウントを作る導線を持っていない）。
 *
 * ただし識別子をクライアントに自由に作らせてはいけない。
 * localStorage の UUID を素直に信じると、ランダムな文字列を100個投げるだけで
 * 「100人が同意」を捏造できる。追認は情報の信頼性を担保する仕組みなので、
 * ここが偽装できると設計の土台が抜ける。
 *
 * そこでサーバが HMAC 署名した値を HttpOnly cookie で配る。
 * ユーザーは何も入力しない（体験は登録なしのまま）が、
 * 偽造にはサーバからの発行が毎回必要になる。
 *
 * ── 発行のタイミングについて ──
 * middleware でページ応答に Set-Cookie を載せてはいけない。
 * 一覧ページは Cloudflare で 30〜60秒キャッシュするため、
 * キャッシュに Set-Cookie が焼き付くと全員が同じトークンを共有する。
 * よって「最初の書き込み時に API レスポンスで発行する」方式をとる。
 * API は常に no-store なのでキャッシュされない。
 */

const COOKIE = 'bousai_id';
const MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.TOKEN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TOKEN_SECRET が設定されていません');
  }
  return 'dev-only-insecure-secret';
}

// Web Crypto を使う。Node ランタイムでもそのまま動く。
async function sign(id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id));
  return Buffer.from(sig).toString('base64url');
}

/** 一定時間で比較する。署名の一致を早期リターンで漏らさない */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const i = value.lastIndexOf('.');
  if (i <= 0) return null;
  const id = value.slice(0, i);
  const sig = value.slice(i + 1);
  return safeEqual(sig, await sign(id)) ? id : null;
}

export interface Identity {
  /** DBに保存する投稿者ID */
  id: string;
  /** 新規発行した場合のみ。レスポンスに Set-Cookie を載せる必要がある */
  issuedCookie?: { name: string; value: string; maxAge: number };
}

/**
 * cookie を検証し、無ければ新しく発行する。
 * issuedCookie が返ったら、呼び出し側で必ずレスポンスに載せること。
 */
export async function getOrIssueIdentity(): Promise<Identity> {
  const store = await cookies();
  const existing = await verify(store.get(COOKIE)?.value);
  if (existing) return { id: existing };

  const id = crypto.randomUUID();
  const value = `${id}.${await sign(id)}`;
  return { id, issuedCookie: { name: COOKIE, value, maxAge: MAX_AGE } };
}

/** 書き込み系レスポンスに、発行した cookie を載せる */
export function attachIdentity<T>(
  res: NextResponse<T>,
  identity: Identity
): NextResponse<T> {
  if (identity.issuedCookie) {
    res.cookies.set({
      name: identity.issuedCookie.name,
      value: identity.issuedCookie.value,
      httpOnly: true, // JSから読めない・書き換えられない
      sameSite: 'lax',
      path: '/',
      maxAge: identity.issuedCookie.maxAge,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return res;
}

/**
 * 実IP。Cloudflare 経由では CF-Connecting-IP に入る。
 * これを使う前に nginx 側で set_real_ip_from を必ず設定すること
 * （忘れると全員が同じIPに見え、IPベースの抑制が無意味になる）。
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  );
}
