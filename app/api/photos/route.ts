import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PHOTO } from '@/lib/photo';
import { getOrIssueIdentity, attachIdentity, clientIp } from '@/lib/identity';
import { recentPhotoCountByIp } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** 保存先。systemd の ReadWritePaths に含まれる場所に置く */
function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
}

/**
 * 写真の受け取り。
 *
 * 中身は必ずクライアントで canvas 再描画済みの WebP。
 * そこで EXIF（GPS座標・端末情報）が落ちている。
 * サーバでは受け直さず、形式と大きさだけ確かめる。
 *
 * 画像処理ライブラリをサーバに入れていないのは意図的。
 * 依存が増えるうえ、災害時のCPUを画像変換に使いたくない。
 */
export async function POST(req: Request) {
  const identity = await getOrIssueIdentity();
  const ip = clientIp(req);

  // 連投で容量を食い潰されるのを防ぐ
  if (ip !== 'unknown' && (await recentPhotoCountByIp(ip, 10)) >= 10) {
    return NextResponse.json(
      { error: '短時間に写真を送りすぎています。少し時間をおいてください。' },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '受け取れませんでした' }, { status: 400 });
  }

  const file = form.get('photo');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '写真が含まれていません' }, { status: 400 });
  }
  if (file.size > PHOTO.maxBytes) {
    return NextResponse.json(
      { error: '写真が大きすぎます。撮り直すか、別の写真をお試しください。' },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // 拡張子ではなく中身で判定する。
  // WebP は "RIFF....WEBP"、JPEG は FF D8 FF。
  // JPEGも受けるのは、canvas.toBlob の image/webp に対応していない端末
  // （古いSafari）があり、そこでは JPEG にせざるを得ないため。
  const isWebp =
    buf.length > 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const isJpeg =
    buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!isWebp && !isJpeg) {
    return NextResponse.json({ error: '対応していない形式です' }, { status: 415 });
  }
  const ext = isWebp ? 'webp' : 'jpg';

  // 日付で切ると、期限切れの削除がディレクトリ単位で済む
  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const name = `${randomUUID()}.${ext}`;
  const abs = path.join(uploadRoot(), dir, name);

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);

  return attachIdentity(
    NextResponse.json({ ok: true, path: `${dir}/${name}`, bytes: buf.length }),
    identity
  );
}
