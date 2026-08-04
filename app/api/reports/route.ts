import { NextResponse } from 'next/server';
import { insertReport } from '@/lib/queries';
import { getOrIssueIdentity, attachIdentity } from '@/lib/identity';

export const dynamic = 'force-dynamic';

/** 通報。管理画面のキューに積むだけで、即時の削除はしない */
export async function POST(req: Request) {
  let body: { observationId?: string; spotId?: string; reason?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const reason = (body.reason ?? '').trim().slice(0, 200);
  if (!reason || (!body.observationId && !body.spotId)) {
    return NextResponse.json({ error: '対象と理由が必要です' }, { status: 400 });
  }
  const identity = await getOrIssueIdentity();
  await insertReport({
    observationId: body.observationId ?? null,
    spotId: body.spotId ?? null,
    reason,
    reporterToken: identity.id,
  });
  return attachIdentity(NextResponse.json({ ok: true }), identity);
}
