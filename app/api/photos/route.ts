import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PHOTO } from '@/lib/photo';
import { getOrIssueIdentity, attachIdentity, clientIp } from '@/lib/identity';
import { recentPhotoCountByIp, photoBytesTotal } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** 保存先。systemd の ReadWritePaths に含まれる場所に置く */
function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
}

/**
 * 中身で形式を判定する。拡張子は信じない。
 * WebP は "RIFF....WEBP"、JPEG は FF D8 FF。
 * JPEGも受けるのは、canvas.toBlob の image/webp に対応していない端末
 * （古いSafari）があり、そこでは JPEG にせざるを得ないため。
 */
function detectExt(buf: Buffer): 'webp' | 'jpg' | null {
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

/**
 * 使用容量の見張り。
 *
 * 投稿のたびにDBを合計すると無駄なので、1分だけ結果を持つ。
 * 上限を1分ぶん超過することはあるが、上限は5GBで1分に入る量は
 * たかが知れている。精度より、災害時に毎回SUMを走らせないことを取る。
 */
let cachedTotal = { bytes: 0, at: 0 };
async function overQuota(): Promise<boolean> {
  const now = Date.now();
  if (now - cachedTotal.at > 60_000) {
    cachedTotal = { bytes: await photoBytesTotal(), at: now };
  }
  // DBの合計にはサムネイルと孤児ファイルが乗らない。1.2倍で見積もる
  return cachedTotal.bytes * 1.2 >= PHOTO.maxTotalBytes;
}

/**
 * 写真の受け取り。
 *
 * 中身は必ずクライアントで canvas 再描画済みの WebP か JPEG。
 * そこで EXIF（GPS座標・端末情報）が落ちている。
 * サーバでは受け直さず、形式と大きさだけ確かめる。
 *
 * 画像処理ライブラリをサーバに入れていないのは意図的。
 * 依存が増えるうえ、災害時のCPUを画像変換に使いたくない。
 * 一覧用のサムネイルもクライアントで作らせている。
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

  // このVPSには商用9サイトが同居している。防災サイトがディスクを
  // 食い潰して巻き込むことは避ける（lib/photo.ts の maxTotalBytes）。
  // 報告そのものは通るので、写真なしで送ってもらう。
  if (await overQuota()) {
    return NextResponse.json(
      {
        error:
          '写真の保存容量が上限に達しました。文字での報告はそのまま送れます。',
      },
      { status: 507 }
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
  const ext = detectExt(buf);
  if (!ext) {
    return NextResponse.json({ error: '対応していない形式です' }, { status: 415 });
  }

  // 日付で切ると、期限切れの削除がディレクトリ単位で済む
  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const id = randomUUID();
  const name = `${id}.${ext}`;
  const abs = path.join(uploadRoot(), dir, name);

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);

  // 一覧カード用のサムネイル。原寸と同じ名前に _t を付けて置くので、
  // DBに列を足さずに対応が取れる（lib/photo.ts の thumbPath）。
  //
  // サムネイルが無くても投稿は成立させる。ここで失敗を返すと、
  // 写真付きの報告が丸ごと落ちる。一覧に小さい画像が出ないだけの話で、
  // 災害時に失う情報の重さが釣り合わない。
  const thumb = form.get('thumb');
  if (thumb instanceof File && thumb.size > 0 && thumb.size <= PHOTO.maxBytes) {
    const tbuf = Buffer.from(await thumb.arrayBuffer());
    // サムネイルも中身を確かめる。原寸と同じ形式でなければ捨てる
    if (detectExt(tbuf) === ext) {
      await writeFile(path.join(uploadRoot(), dir, `${id}_t.${ext}`), tbuf);
    }
  }

  return attachIdentity(
    NextResponse.json({ ok: true, path: `${dir}/${name}`, bytes: buf.length }),
    identity
  );
}
