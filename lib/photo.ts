/**
 * 写真の受け入れ条件。サーバとクライアントで同じ値を使う。
 */
export const PHOTO = {
  /** 長辺の上限。これ以上は災害時の回線で送れない */
  maxEdge: 1280,
  /** WebPの品質。行列や貼り紙が読めれば十分 */
  quality: 0.72,
  /** サーバ側で受け付ける上限。圧縮後なら通常150KB前後 */
  maxBytes: 1_200_000,
  /** 保存期間。TTLを超えた情報に付いた写真は価値がない */
  retentionDays: 14,
} as const;

/**
 * 画像をcanvasで再描画して縮小・WebP化する。
 *
 * ★EXIFを落とすのが主目的でもある。
 * スマホの写真にはGPS座標・端末情報・撮影時刻が埋まっており、
 * そのまま上げると投稿者の居場所が公開される。匿名投稿の意味がなくなる。
 * canvasに描き直すとEXIFは引き継がれない。
 */
export async function compressImage(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;

  const scale = Math.min(1, PHOTO.maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/webp', PHOTO.quality)
  );
}
