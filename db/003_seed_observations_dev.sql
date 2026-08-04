-- 開発用: 鮮度の3段階（fresh / aging / stale）が画面上で確認できるよう、
-- わざと経過時間の違う観測を入れる。
--
-- ガソリンのTTLは120分なので:  <40分=fresh / 40〜120分=aging / >120分=stale
-- 店舗のTTLは360分なので:      <120分=fresh / 120〜360分=aging / >360分=stale

INSERT INTO observations (spot_id, status, observed_at, attrs, note, reporter_token)
SELECT s.id, v.status, now() - (v.age_min || ' minutes')::interval,
       v.attrs::jsonb, v.note, 'seed-dev'
FROM spots s
JOIN (VALUES
  -- ガソリン（TTL 120分）
  ('山形中央SS（仮）',      'available', 15,  '{"waitMinutes":"10"}',                  '在庫あり。並びは少なめ'),
  ('七日町SS（仮）',        'limited',   55,  '{"waitMinutes":"60","limitLiters":"20"}', '20L制限。1時間待ち'),
  ('嶋SS（仮）',            'empty',     95,  '{}',                                    'レギュラー切れ'),
  ('南館SS（仮）',          'available', 200, '{"waitMinutes":"30"}',                  NULL),  -- stale になる
  -- 店舗（TTL 360分）
  ('ヤマザワ 山形北店（仮）', 'open',      30,  '{"waitMinutes":"0"}',                   '通常営業。品揃えあり'),
  ('ヤマザワ 南館店（仮）',   'limited',   180, '{"waitMinutes":"30"}',                  'パンと水は品薄'),
  ('コンビニ山形駅前（仮）',  'open',      10,  '{"waitMinutes":"0"}',                   NULL),
  ('スーパー七日町（仮）',    'closed',    400, '{}',                                    NULL),  -- stale になる
  -- 給水（TTL 720分）
  ('霞城公園 給水拠点（仮）', 'active',    45,  '{"container":"required"}',              '容器持参。18時まで'),
  ('松原浄水場（仮）',        'scheduled', 120, '{"container":"provided"}',              '明日9時から'),
  -- トイレ・入浴
  ('蔵王温泉 共同浴場（仮）', 'available', 90,  '{"fee":"paid"}',                        '入浴可。300円'),
  ('市民会館 トイレ（仮）',   'available', 20,  '{"fee":"free"}',                        NULL),
  -- 物資
  ('山形市総合体育館（仮）',  'active',    25,  '{"items":"水・アルファ米・毛布"}',       '17時まで'),
  -- ライフライン
  ('山形市北部（仮）',        'outage_power', 60, '{}',                                 '一部地域で停電継続'),
  -- 雪モード
  ('山形駅前通り（仮）',      'done',      40,  '{}',                                    '除雪車が入った'),
  ('県道19号 蔵王温泉線（仮）','not_yet',   70,  '{}',                                    '未除雪。轍が深い'),
  ('西蔵王高原ライン（仮）',  'ice',       35,  '{}',                                    'アイスバーン。スタッドレス必須'),
  ('国道286号 笹谷峠（仮）',  'closed',    150, '{}',                                    NULL)
) AS v(spot_name, status, age_min, attrs, note)
  ON s.name = v.spot_name;

-- 追認・否認の例。「3人が同意」「食い違っています」の表示を確認するため。
INSERT INTO confirmations (observation_id, reporter_token, agrees)
SELECT o.id, t.token, t.agrees
FROM observations o
JOIN spots s ON s.id = o.spot_id
JOIN (VALUES
  ('山形中央SS（仮）',      'seed-a', true),
  ('山形中央SS（仮）',      'seed-b', true),
  ('山形中央SS（仮）',      'seed-c', true),
  ('七日町SS（仮）',        'seed-a', true),
  -- 否認が追認を上回る例（食い違いの表示確認用）
  ('ヤマザワ 南館店（仮）',  'seed-a', false),
  ('ヤマザワ 南館店（仮）',  'seed-b', false),
  ('ヤマザワ 南館店（仮）',  'seed-c', true)
) AS t(spot_name, token, agrees)
  ON s.name = t.spot_name
ON CONFLICT DO NOTHING;
