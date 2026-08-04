import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getNoticeKind } from '@/lib/notices';
import { insertNotice } from '@/lib/queries';
import { getOrIssueIdentity, attachIdentity } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const kind = str(body.kind, 20);
  if (!getNoticeKind(kind)) {
    return NextResponse.json({ error: '種類が不正です' }, { status: 400 });
  }

  const title = str(body.title, 60);
  const text = str(body.body, 400);
  // 記名と連絡先は必須。ここを緩めると「ここに物資を送ってください」が
  // 匿名で出せてしまう（db/004_notices.sql 冒頭を参照）
  const organization = str(body.organization, 80);
  const contact = str(body.contact, 120);

  if (!title || !text || !organization || !contact) {
    return NextResponse.json(
      { error: '見出し・内容・団体名・連絡先はすべて必須です' },
      { status: 400 }
    );
  }

  const days = Number(body.days);
  const safeDays = [3, 7, 14, 30].includes(days) ? days : 7;
  const endsAt = new Date(Date.now() + safeDays * 86_400_000);

  // 投稿者を控えておく。あとで本人だけが「終了しました」と閉じられるようにするため
  const identity = await getOrIssueIdentity();

  const row = await insertNotice({
    kind,
    title,
    body: text,
    organization,
    contact,
    municipality: str(body.municipality, 20) || null,
    endsAt,
    ownerToken: identity.id,
  });

  revalidatePath('/notices');
  return attachIdentity(NextResponse.json({ ok: true, id: row.id }), identity);
}
