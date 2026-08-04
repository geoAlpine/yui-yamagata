import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 管理者認証。
 *
 * イマココナビも一般利用者は匿名認証で、ログインがあるのは管理者だけだった。
 * 同じ構えをとる。利用者にアカウントを作らせない一方、
 * 削除やモード切替のような取り返しのつかない操作には認証を要求する。
 *
 * 環境変数のパスワード1本という最小構成。ユーザー管理は作らない。
 * 運用者が1〜2名である間はこれで足り、増えたときに作り直せばよい。
 */

const COOKIE = 'bousai_admin';
const MAX_AGE = 60 * 60 * 12; // 12時間で切れる。共用端末での置き忘れ対策

function secret(): string {
  const s = process.env.TOKEN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TOKEN_SECRET が設定されていません');
  }
  return 'dev-only-insecure-secret';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueAdminCookie(): { name: string; value: string; maxAge: number } {
  const exp = String(Date.now() + MAX_AGE * 1000);
  return { name: COOKIE, value: `${exp}.${sign(exp)}`, maxAge: MAX_AGE };
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const i = raw.lastIndexOf('.');
  if (i <= 0) return false;
  const exp = raw.slice(0, i);
  const sig = raw.slice(i + 1);

  const expect = sign(exp);
  if (sig.length !== expect.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;

  return Number(exp) > Date.now();
}

/**
 * パスワード照合。長さの違いを漏らさないよう、比較の前にハッシュを揃える。
 * 平文比較だと応答時間から文字数が推測できる。
 */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHmac('sha256', secret()).update(input).digest();
  const b = createHmac('sha256', secret()).update(expected).digest();
  return timingSafeEqual(a, b);
}

export const ADMIN_COOKIE = COOKIE;
