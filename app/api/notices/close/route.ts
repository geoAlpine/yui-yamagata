import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { closeNotice } from '@/lib/queries';
import { getOrIssueIdentity } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * 「終了しました」の報告。
 *
 * 掲載期限だけでは足りない。期限内に物資が足りたり募集が埋まったりしたとき、
 * 古い募集が残り続けるのは古い情報を配るのと同じ害になる。
 *
 * ただし他人の募集を勝手に閉じられると妨害の手段になるので、
 * 署名付き匿名IDが投稿者と一致した場合のみ受け付ける。
 */
export async function POST(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const identity = await getOrIssueIdentity();
  const ok = await closeNotice(body.id, identity.id);
  if (!ok) {
    return NextResponse.json(
      { error: 'この端末から投稿されたお知らせではありません' },
      { status: 403 }
    );
  }
  revalidatePath('/notices');
  return NextResponse.json({ ok: true });
}
