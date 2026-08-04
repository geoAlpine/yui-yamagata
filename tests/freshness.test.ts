import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFreshness, formatAge } from '../lib/freshness';
import { getCategory } from '../lib/categories';

/**
 * 鮮度判定はこのサイトの心臓部。
 * ここが壊れると「3日前の営業中」を新鮮な情報として配ることになる。
 * 境界値を明示的に固定しておく。
 */

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

test('ガソリン(TTL120分): 40分未満は fresh', () => {
  assert.equal(evaluateFreshness('gas', at(0)).level, 'fresh');
  assert.equal(evaluateFreshness('gas', at(39)).level, 'fresh');
});

test('ガソリン(TTL120分): 40〜120分は aging で、状態はまだ見せる', () => {
  const f = evaluateFreshness('gas', at(60));
  assert.equal(f.level, 'aging');
  assert.equal(f.showStatus, true);
  // 古くなってきたら再確認を促す。これが情報の生存率を決める
  assert.equal(f.emphasizeConfirm, true);
});

test('ガソリン(TTL120分): 120分を超えたら stale で状態を伏せる', () => {
  const f = evaluateFreshness('gas', at(121));
  assert.equal(f.level, 'stale');
  // TTL超過後に状態を出し続けると嘘をつくことになる
  assert.equal(f.showStatus, false);
});

test('カテゴリごとにTTLが違う（一律にしない）', () => {
  // 同じ経過時間でも、ガソリンは腐り、断水情報はまだ生きている
  assert.equal(evaluateFreshness('gas', at(200)).level, 'stale');
  assert.equal(evaluateFreshness('lifeline', at(200)).level, 'fresh');
});

test('未知のカテゴリでも落ちない（既定720分）', () => {
  const f = evaluateFreshness('no_such_category', at(10));
  assert.equal(f.ttlMinutes, 720);
  assert.equal(f.level, 'fresh');
});

test('未来の時刻でも負の経過時間にならない', () => {
  assert.equal(evaluateFreshness('gas', at(-60)).ageMinutes, 0);
});

test('文字列の日時も受け付ける（API経由ではJSON文字列で届く）', () => {
  // gas は TTL120分なので 40分未満が fresh、40〜120分が aging
  assert.equal(evaluateFreshness('gas', at(10).toISOString()).level, 'fresh');
  assert.equal(evaluateFreshness('gas', at(60).toISOString()).level, 'aging');
  assert.equal(evaluateFreshness('gas', at(200).toISOString()).level, 'stale');
});

test('formatAge の表記', () => {
  assert.equal(formatAge(0), 'たった今');
  assert.equal(formatAge(1), '1分前');
  assert.equal(formatAge(59), '59分前');
  assert.equal(formatAge(60), '1時間前');
  assert.equal(formatAge(1439), '23時間前');
  assert.equal(formatAge(1440), '1日前');
});

test('境界: 経過がちょうど TTL のときは stale', () => {
  const ttl = getCategory('gas')!.ttlMinutes;
  assert.equal(evaluateFreshness('gas', at(ttl)).level, 'stale');
});
