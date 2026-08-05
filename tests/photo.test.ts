import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO, thumbPath } from '../lib/photo';

/**
 * サムネイルの命名規則は、独立した3か所が同じ前提を持って初めて成立する。
 *
 *   1. app/api/photos/route.ts   `${id}_t.${ext}` で保存する
 *   2. components/SpotCard.tsx   thumbPath() で表示する
 *   3. scripts/purge_photos.mjs  thumbPath() で削除する
 *
 * DBに列を持たず、原寸のパスから機械的に導いているため、
 * ここがずれると「表示されない」だけでなく「消えずに残り続ける」。
 * 後者は静かに起きる。14日で消すという約束が破れていても誰も気づかない。
 *
 * 3のスクリプトは .mjs で同じ関数を複製している（node からTSを読ませない判断）。
 * 複製である以上、規則そのものをここで固定しておく。
 */

test('サムネイルのパス: 拡張子の直前に _t を挟む', () => {
  assert.equal(
    thumbPath('2026/08/9bebe520-ac1d-4ad7-bf55-f20076bdec14.webp'),
    '2026/08/9bebe520-ac1d-4ad7-bf55-f20076bdec14_t.webp'
  );
  assert.equal(
    thumbPath('2026/08/9bebe520-ac1d-4ad7-bf55-f20076bdec14.jpg'),
    '2026/08/9bebe520-ac1d-4ad7-bf55-f20076bdec14_t.jpg'
  );
});

test('サムネイルのパス: 対応していない拡張子は変えない', () => {
  // 想定外の値が来たとき、勝手に別のパスを作らない。
  // 実在しないファイルを消しにいくより、何もしないほうが安全。
  assert.equal(thumbPath('2026/08/x.png'), '2026/08/x.png');
});

test('サムネイルのパス: ディレクトリ名の webp を書き換えない', () => {
  // 置換を末尾に固定していないと、パスの途中を壊す
  assert.equal(thumbPath('webp/08/a.jpg'), 'webp/08/a_t.jpg');
});

test('サムネイルは原寸よりはっきり小さい', () => {
  // ここが逆転すると、一覧を軽くするという目的が消える
  assert.ok(PHOTO.thumbEdge < PHOTO.maxEdge / 2);
  assert.ok(PHOTO.thumbQuality < PHOTO.quality);
});

test('保存容量の上限が1枚あたりの上限より十分大きい', () => {
  // 上限を下回ると、1枚目から拒否され続ける
  assert.ok(PHOTO.maxTotalBytes > PHOTO.maxBytes * 1000);
});
