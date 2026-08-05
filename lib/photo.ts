/**
 * 写真の受け入れ条件と、送信前の変換。
 *
 * スマホの写真はそのままでは使えない。実機で起きること:
 *
 *  1. 向きが90度回る
 *     縦で撮った写真はEXIFに回転情報が入っている。canvasに描くとき
 *     これを適用しないと横倒しになる。createImageBitmap の既定挙動は
 *     ブラウザ差があるので imageOrientation を明示する。
 *
 *  2. WebPに変換できない端末がある
 *     canvas.toBlob(..., 'image/webp') は古いSafariが対応していない。
 *     しかもエラーにならず黙ってPNGを返す。150KBのはずが数MBになり、
 *     サーバの上限で弾かれる。「iPhoneで写真が送れない」という形で出る。
 *     → 出来上がったBlobの type を確かめ、駄目ならJPEGにする。
 *
 *  3. HEIC（iPhoneの標準形式）
 *     iOSのファイル選択は通常JPEGに変換するが、常にではない。
 *     読めなかったときは黙らずに理由を返す。
 *
 * EXIFを落とすのはcanvas再描画の副産物だが、こちらが本来の目的でもある。
 * GPS座標が残ると投稿者の居場所が公開され、匿名投稿の意味がなくなる。
 */

export const PHOTO = {
  /** 長辺の上限。これ以上は災害時の回線で送れない */
  maxEdge: 1280,
  quality: 0.72,
  /** サーバ側の上限。圧縮後なら通常150KB前後 */
  maxBytes: 1_200_000,
  /** 保存期間。TTLを超えた情報に付いた写真は価値がない */
  retentionDays: 14,
} as const;

export type CompressResult =
  | { ok: true; blob: Blob; type: 'image/webp' | 'image/jpeg' }
  | { ok: false; reason: string };

export async function compressImage(file: File): Promise<CompressResult> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    return { ok: false, reason: '画像ファイルを選んでください' };
  }

  let bitmap: ImageBitmap;
  try {
    // ★ from-image を明示する。既定に任せると端末によって横倒しになる
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return {
      ok: false,
      reason: /\.(heic|heif)$/i.test(file.name)
        ? 'この形式（HEIC）は読み込めませんでした。カメラで撮り直すか、別の写真をお試しください。'
        : 'この画像は読み込めませんでした。別の写真をお試しください。',
    };
  }

  const scale = Math.min(1, PHOTO.maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'この端末では画像を処理できませんでした' };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const encode = (type: string) =>
    new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), type, PHOTO.quality));

  // WebPを試し、返ってきたものが本当にWebPかを確かめる。
  // 非対応端末は黙ってPNGを返すので、type を見ないと気づけない。
  let blob = await encode('image/webp');
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await encode('image/jpeg');
    type = 'image/jpeg';
  }
  if (!blob) return { ok: false, reason: '画像を変換できませんでした' };

  if (blob.size > PHOTO.maxBytes) {
    return {
      ok: false,
      reason: '写真が大きすぎます。もう少し引いて撮るか、別の写真をお試しください。',
    };
  }
  return { ok: true, blob, type };
}
