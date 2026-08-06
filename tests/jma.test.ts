import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeQuake as rawQuake,
  judgeWarning as rawWarning,
} from '../scripts/watch_jma.mjs';

/** .mjs 側に型が無いので、テストで期待する形をここで宣言する */
type Verdict = { action: 'switch' | 'notify'; hazard: string | null; label: string } | null;
const judgeQuake = rawQuake as (xml: string) => Verdict;
const judgeWarning = rawWarning as (xml: string) => Verdict;

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
