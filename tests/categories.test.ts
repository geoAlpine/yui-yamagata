import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES, categoriesForMode, getCategory, getStatus, attrsForStatus,
} from '../lib/categories';
import { NOTICE_KINDS, getNoticeKind } from '../lib/notices';

/**
 * カテゴリ定義の整合性。
 *
 * この定義はドメインの中心で、手で編集する機会が多い。
 * 属性の onlyForStatus が存在しない状態を指していても実行時は静かに無視されるだけで、
 * 「待ち時間の入力欄が出ない」という形でしか気づけない。ここで落とす。
 */

test('IDが重複していない', () => {
  const ids = CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('全カテゴリに必須項目が揃っている', () => {
  for (const c of CATEGORIES) {
    assert.ok(c.label, `${c.id}: label がない`);
    assert.ok(c.short, `${c.id}: short がない`);
    assert.ok(c.ttlMinutes > 0, `${c.id}: ttlMinutes が不正`);
    assert.ok(c.statuses.length >= 2, `${c.id}: 状態が2つ未満`);
    assert.ok(
      ['disasterOnly', 'needsReport'].includes(c.emptyReason),
      `${c.id}: emptyReason が不正`
    );
  }
});

test('絵文字を使っていない（端末差で崩れ、災害情報の画面では軽く見える）', () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const c of CATEGORIES) {
    assert.ok(!emoji.test(c.label), `${c.id}: label に絵文字`);
    assert.ok(!emoji.test(c.short), `${c.id}: short に絵文字`);
    for (const s of c.statuses) {
      assert.ok(!emoji.test(s.label), `${c.id}/${s.id}: 状態ラベルに絵文字`);
    }
  }
});

test('状態のIDがカテゴリ内で重複していない', () => {
  for (const c of CATEGORIES) {
    const ids = c.statuses.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${c.id}: 状態IDが重複`);
  }
});

test('属性の onlyForStatus が実在する状態を指している', () => {
  for (const c of CATEGORIES) {
    const valid = new Set(c.statuses.map((s) => s.id));
    for (const a of c.attrs ?? []) {
      for (const s of a.onlyForStatus ?? []) {
        assert.ok(valid.has(s), `${c.id}/${a.id}: 存在しない状態 '${s}' を指している`);
      }
    }
  }
});

test('選択式の属性には選択肢がある', () => {
  for (const c of CATEGORIES) {
    for (const a of c.attrs ?? []) {
      if (a.type === 'select') {
        assert.ok(a.options?.length, `${c.id}/${a.id}: select なのに options がない`);
      }
    }
  }
});

test('モードごとに1つ以上のカテゴリがある', () => {
  assert.ok(categoriesForMode('disaster').length > 0);
  assert.ok(categoriesForMode('snow').length > 0);
});

test('モード内で order が重複していない（表示順が不定になる）', () => {
  for (const mode of ['disaster', 'snow'] as const) {
    const orders = categoriesForMode(mode).map((c) => c.order);
    assert.equal(new Set(orders).size, orders.length, `${mode}: order が重複`);
  }
});

test('腐りやすいものほどTTLが短い', () => {
  // ガソリンの行列は30分で変わる。断水は1日もつ。この大小関係は崩さない
  assert.ok(getCategory('gas')!.ttlMinutes < getCategory('store')!.ttlMinutes);
  assert.ok(getCategory('store')!.ttlMinutes < getCategory('lifeline')!.ttlMinutes);
});

test('attrsForStatus が状態に応じて絞り込む', () => {
  // 在庫なしのときに「待ち時間」を聞くのは無意味
  const onEmpty = attrsForStatus('gas', 'empty').map((a) => a.id);
  assert.ok(!onEmpty.includes('waitMinutes'));

  const onAvailable = attrsForStatus('gas', 'available').map((a) => a.id);
  assert.ok(onAvailable.includes('waitMinutes'));

  // 給油上限は「数量制限あり」のときだけ
  assert.ok(!onAvailable.includes('limitLiters'));
  assert.ok(attrsForStatus('gas', 'limited').map((a) => a.id).includes('limitLiters'));
});

test('getStatus が未知のIDで落ちない', () => {
  assert.equal(getStatus('gas', 'no_such_status'), undefined);
  assert.equal(getStatus('no_such_category', 'available'), undefined);
});

test('お知らせの種別には必ず注意書きがある', () => {
  // 注意書きが誤用の唯一の防波堤（詐欺・善意の殺到）
  for (const k of NOTICE_KINDS) {
    assert.ok(k.caution && k.caution.length > 20, `${k.id}: caution が薄い`);
  }
  assert.equal(getNoticeKind('no_such_kind'), undefined);
});

test('ボランティア募集は公式窓口へ誘導している', () => {
  // 個人の呼びかけで現地に人が殺到すると二次被害になる
  assert.ok(getNoticeKind('volunteer')?.officialLink?.href);
});
