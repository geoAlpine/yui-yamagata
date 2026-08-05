import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { withdrawObservation } from '@/lib/queries';
import { getOrIssueIdentity } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * 自分の報告を取り消す。
 * 本人以外は取り消せない。他人の報告を消せると、正しい情報を消す手段になる。
 */
export async function POST(req: Request) {
  let body: { id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const identity = await getOrIssueIdentity();
  const r = await withdrawObservation(body.id, identity.id);
  if (!r) {
    return NextResponse.json(
      { error: 'この端末から出した報告ではありません' },
      { status: 403 }
    );
  }
  revalidatePath('/');
  revalidatePath(`/spots/${r.spotId}`);
  return NextResponse.json({ ok: true });
}
