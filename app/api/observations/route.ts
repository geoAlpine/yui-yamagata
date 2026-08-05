import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCategory, attrsForStatus } from '@/lib/categories';
import { getSpot, insertObservation, recentObservationCount } from '@/lib/queries';
import { getOrIssueIdentity, attachIdentity, clientIp } from '@/lib/identity';

export const dynamic = 'force-dynamic';

const NOTE_MAX = 80;

export async function POST(req: Request) {
  let body: {
    spotId?: string;
    status?: string;
    observedMinutesAgo?: number;
    attrs?: Record<string, string>;
    note?: string;
    photoPath?: string;
    photoBytes?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const { spotId, status } = body;
  if (!spotId || !status) {
    return NextResponse.json({ error: '必要な項目が足りません' }, { status: 400 });
  }

  // 投稿者IDはボディからは受け取らない。署名付き cookie のみを信じる。
  const identity = await getOrIssueIdentity();
  const reporterToken = identity.id;

  const spot = await getSpot(spotId);
  if (!spot) {
    return NextResponse.json({ error: '場所が見つかりません' }, { status: 404 });
  }

  // 状態はカテゴリ定義に存在するものだけ受け付ける
  const cat = getCategory(spot.category);
  if (!cat?.statuses.some((s) => s.id === status)) {
    return NextResponse.json({ error: '状態が不正です' }, { status: 400 });
  }

  // 連投の抑制。事前審査をしない代わりの最低限の防波堤（DESIGN.md 6章）
  const recent = await recentObservationCount(reporterToken, spotId, 5);
  if (recent >= 3) {
    return NextResponse.json(
      { error: '短時間に同じ場所へ報告しすぎています。少し時間をおいてください。' },
      { status: 429 }
    );
  }

  // 属性は「その状態で意味を持つもの」だけに絞って保存する
  const allowed = new Set(attrsForStatus(spot.category, status).map((a) => a.id));
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.attrs ?? {})) {
    if (allowed.has(k) && typeof v === 'string' && v !== '') {
      attrs[k] = v.slice(0, 60);
    }
  }

  // observed_at は「実際に見た時刻」。投稿時刻とは別物として扱う。
  // 圏外から戻って後でまとめて投稿する人がいるため、ここを混ぜると誤情報になる。
  const minsAgo = Number(body.observedMinutesAgo ?? 0);
  const safeMins = Number.isFinite(minsAgo) ? Math.min(Math.max(minsAgo, 0), 1440) : 0;
  const observedAt = new Date(Date.now() - safeMins * 60_000);

  const note = (body.note ?? '').trim().slice(0, NOTE_MAX) || null;

  // 写真のパスは /api/photos が返した形式（YYYY/MM/uuid.webp）だけ受ける。
  // 任意の文字列を通すと、別のファイルを指させる余地ができる。
  const photoPath =
    typeof body.photoPath === 'string' &&
    /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/.test(body.photoPath)
      ? body.photoPath
      : null;

  const row = await insertObservation({
    spotId,
    status,
    observedAt,
    attrs,
    note,
    reporterToken,
    ip: clientIp(req),
    photoPath,
    photoBytes: photoPath ? Number(body.photoBytes) || null : null,
  });

  revalidatePath('/');
  revalidatePath(`/spots/${spotId}`);

  return attachIdentity(NextResponse.json({ ok: true, id: row.id }), identity);
}
