import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { upsertConfirmation, recentConfirmationCountByIp } from '@/lib/queries';
import { getOrIssueIdentity, attachIdentity, clientIp } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/**
 * 「まだこの状況ですか？」の1タップ。
 * これがあるかないかで情報の生存率がまるで変わる（DESIGN.md 3.4）。
 *
 * 投稿者IDはリクエストボディからは受け取らない。署名付き cookie のみを信じる。
 * ボディの文字列を信じると票の水増しが自由にできてしまう（lib/identity.ts 参照）。
 */
export async function POST(req: Request) {
  let body: { observationId?: string; agrees?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { observationId, agrees } = body;
  if (!observationId || typeof agrees !== 'boolean') {
    return NextResponse.json({ error: '必要な項目が足りません' }, { status: 400 });
  }

  const identity = await getOrIssueIdentity();
  const ip = clientIp(req);

  // cookie は消せば作り直せるので、IPでも歯止めをかける。
  // 同一IPから短時間に大量の追認が飛ぶのは票の水増し以外にほぼ理由がない。
  if (ip !== 'unknown') {
    const n = await recentConfirmationCountByIp(ip, 10);
    if (n >= 30) {
      return NextResponse.json(
        { error: '短時間に操作が集中しています。少し時間をおいてください。' },
        { status: 429 }
      );
    }
  }

  try {
    await upsertConfirmation({
      observationId,
      agrees,
      reporterToken: identity.id,
      ip,
    });
  } catch {
    return NextResponse.json({ error: '観測が見つかりません' }, { status: 404 });
  }

  revalidatePath('/');
  return attachIdentity(NextResponse.json({ ok: true }), identity);
}
