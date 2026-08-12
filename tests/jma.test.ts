import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeQuake,
  judgeWarning,
  normalizeKind,
  shouldRing,
} from '../scripts/watch_jma.mjs';

/**
 * 災害モードの自動切替の判定。
 *
 * ここは平時には一度も動かず、災害の当日に初めて本番で走る。
 * 「動かなかった」ことに気づく機会が無いまま、いちばん必要なときに
 * 平時モードのままになる、という壊れ方をする。
 *
 * 実際の気象庁XMLの構造（2026-08-06 に取得して確認）を写した断片で固定する。
 *   <Pref><Name>熊本県</Name><Code>43</Code><MaxInt>1</MaxInt>
 *     <Area>...<City>...<IntensityStation>...
 * 震度は 5弱="5-" 5強="5+"。
 *
 * 平時に戻す判定はここに無い。自動では戻さないため（手動のみ）。
 * 「もう大丈夫」を機械に判断させると、断水や物資不足が続いている
 * いちばん必要な時期に平時モードへ戻ってしまう。
 */

const pref = (name: string, maxInt: string) =>
  `<Pref><Name>${name}</Name><Code>06</Code><MaxInt>${maxInt}</MaxInt>` +
  `<Area><Name>${name}村山</Name><Code>710</Code><MaxInt>${maxInt}</MaxInt>` +
  `<City><Name>山形市</Name><Code>0620100</Code><MaxInt>${maxInt}</MaxInt>` +
  `<IntensityStation><Name>山形市緑町</Name><Code>0620100</Code><Int>${maxInt}</Int>` +
  `</IntensityStation></City></Area></Pref>`;

const quakeDoc = (...prefs: string[]) =>
  `<Report><Head><Title>震源・震度に関する情報</Title></Head>` +
  `<Body><Intensity><Observation>${prefs.join('')}</Observation></Intensity></Body></Report>`;

test('地震: 山形県が震度5弱なら災害モードへ', () => {
  const v = judgeQuake(quakeDoc(pref('山形県', '5-')));
  assert.ok(v, "判定結果が返らない");
  assert.equal(v.action, 'switch');
  assert.equal(v.hazard, 'earthquake');
  assert.equal(v.label, '最大震度5弱');
});

test('地震: 震度5強・6弱・7も災害モードへ', () => {
  for (const [code, label] of [['5+', '5強'], ['6-', '6弱'], ['7', '7']]) {
    const v = judgeQuake(quakeDoc(pref('山形県', code)));
    assert.ok(v, `震度${label}で判定結果が返らない`);
    assert.equal(v.action, 'switch', `震度${label}で切り替わらない`);
    assert.equal(v.label, `最大震度${label}`);
  }
});

test('地震: 震度4は通知のみ。切り替えない', () => {
  const v = judgeQuake(quakeDoc(pref('山形県', '4')));
  assert.ok(v, "判定結果が返らない");
  assert.equal(v.action, 'notify');
});

test('地震: 震度3以下は何もしない', () => {
  assert.equal(judgeQuake(quakeDoc(pref('山形県', '3'))), null);
  assert.equal(judgeQuake(quakeDoc(pref('山形県', '1'))), null);
});

test('★地震: 他県が震度6強でも、山形が震度2なら切り替えない', () => {
  // ここを間違えると、熊本の地震で山形が災害モードになる。
  // 全国の MaxInt を拾う実装だと通ってしまうので、県単位の切り出しを固定する。
  assert.equal(judgeQuake(quakeDoc(pref('熊本県', '6+'), pref('山形県', '2'))), null);
});

test('★地震: 山形県が含まれない発表では何もしない', () => {
  assert.equal(judgeQuake(quakeDoc(pref('熊本県', '7'))), null);
});

test('地震: 複数県のうち山形だけを見る', () => {
  const v = judgeQuake(quakeDoc(pref('宮城県', '3'), pref('山形県', '5+'), pref('秋田県', '4')));
  assert.ok(v, "判定結果が返らない");
  assert.equal(v.action, 'switch');
  assert.equal(v.label, '最大震度5強');
});

// ─────────────────────────────────────────────

const warnDoc = (...kinds: string[]) =>
  `<Report><Head><Title>山形県気象警報・注意報</Title></Head><Body>` +
  kinds.map((k) => `<Item><Kind><Name>${k}</Name><Code>33</Code></Kind></Item>`).join('') +
  `</Body></Report>`;

test('警報: 大雨特別警報は災害モードへ。種別は洪水', () => {
  const v = judgeWarning(warnDoc('大雨特別警報', '洪水警報'));
  assert.ok(v, "判定結果が返らない");
  assert.equal(v.action, 'switch');
  assert.equal(v.hazard, 'flood');
});

test('警報: 大雨以外の特別警報も災害モードへ。種別は決めない', () => {
  // 暴風雪特別警報で洪水向けの避難場所に絞ると、対応する場所を隠してしまう
  const v = judgeWarning(warnDoc('暴風雪特別警報'));
  assert.ok(v, "判定結果が返らない");
  assert.equal(v.action, 'switch');
  assert.equal(v.hazard, null);
});

test('警報: 土砂災害警戒情報・大雨警報は通知のみ', () => {
  assert.equal(judgeWarning(warnDoc('土砂災害警戒情報'))?.action, 'notify');
  assert.equal(judgeWarning(warnDoc('大雨警報'))?.action, 'notify');
});

test('警報: 注意報だけなら何もしない', () => {
  assert.equal(judgeWarning(warnDoc('雷注意報', '波浪注意報')), null);
});

// ───────── 45通の再発 ─────────
//
// 2026-08-07 14:52 〜 08-08 17:00 の大雨警報で45通のメールが届いた。
// 警報はその間ずっと継続していた。以下はその45通を再現しないための固定。

test('★警報: 同じ発表の3形式が同じ種別に畳まれる', () => {
  // 気象庁は1回の発表を3つの文書で配信し、Ｒ０６形式だけ警報名に
  // 警戒レベルが付く。畳まないと1回の発表で3通になる。
  const vpww53 = judgeWarning(warnDoc('大雨警報'));         // 気象特別警報・警報・注意報
  const vpww54 = judgeWarning(warnDoc('大雨警報'));         // 気象警報・注意報（Ｈ２７）
  const r06 = judgeWarning(warnDoc('レベル３大雨警報'));     // 気象警報・注意報（Ｒ０６）（大雨）
  assert.deepEqual(vpww53?.kinds, ['大雨警報']);
  assert.deepEqual(vpww54?.kinds, ['大雨警報']);
  assert.deepEqual(r06?.kinds, ['大雨警報'], 'レベル表記が落ちていない');
});

test('★警報: 市町村の数だけ並んだ同じ警報を1件に畳む', () => {
  // 実物の文書には市町村ごとに Kind が並ぶ（実測で106〜142個）
  const many = Array.from({ length: 120 }, () => '大雨警報');
  assert.deepEqual(judgeWarning(warnDoc(...many, 'レベル３大雨警報'))?.kinds, ['大雨警報']);
});

test('警報: レベル表記の正規化', () => {
  assert.equal(normalizeKind('レベル３大雨警報'), '大雨警報');
  assert.equal(normalizeKind('レベル4土砂災害警戒情報'), '土砂災害警戒情報');
  assert.equal(normalizeKind('大雨警報'), '大雨警報');
  // 「レベル」で始まらないものを削らない
  assert.equal(normalizeKind('暴風雪特別警報'), '暴風雪特別警報');
});

test('★警報: 継続中の同じ警報は鳴らさない', () => {
  const now = Date.parse('2026-08-08T13:39:00+09:00');
  // 2分前に見かけて通知済み。再発表されただけなので鳴らさない
  const prev = { last_seen: '2026-08-08T13:37:00+09:00', notified_at: '2026-08-07T14:52:00+09:00' };
  assert.equal(shouldRing(prev, 6, now), false);
});

test('警報: 一度も通知していなければ鳴らす', () => {
  assert.equal(shouldRing(null), true);
  assert.equal(shouldRing({ last_seen: '2026-08-08T13:37:00+09:00', notified_at: null }), true);
});

test('警報: 収まってから間が空けば、次に出たときは鳴らす', () => {
  const now = Date.parse('2026-08-09T00:00:00+09:00');
  const prev = { last_seen: '2026-08-08T17:00:00+09:00', notified_at: '2026-08-07T14:52:00+09:00' };
  assert.equal(shouldRing(prev, 6, now), true, '7時間空いたら別の一続きとして鳴らす');
  assert.equal(shouldRing(prev, 12, now), false, 'しきい値内なら鳴らさない');
});

test('★警報: 継続中に種別が増えたら、増えた分は鳴る', () => {
  // 大雨警報の最中に洪水警報が加わるのは状況の悪化。ここを黙らせてはいけない
  const v = judgeWarning(warnDoc('大雨警報', 'レベル３大雨警報', '洪水警報'));
  assert.deepEqual(v?.kinds, ['大雨警報', '洪水警報']);
  assert.equal(shouldRing(null), true, '洪水警報には記録が無いので鳴る');
});
