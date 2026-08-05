-- リハーサル用: 豪雨災害のシナリオ
--
-- ★ステージング専用。本番に流してはいけない。
--   スクリプト側でDB名を検査して弾いているが、手で流すときも確認すること。
--
-- 想定: 令和6年7月豪雨（2024/7/24-27）の再現。
--   庄内・最上を中心に記録的な大雨。住宅被害1,379棟（うち床上浸水427棟）。
--   災害救助法が6市7町3村に適用。
--
-- 豪雨は地震と必要な情報が違う。冠水・災害ごみ仮置場・ボランティアが効く。
-- 給油の行列や充電は地震ほど前面に出ない。
-- この違いを平時に体感しておくのがリハーサルの目的。

-- 発災してから生まれる場所を作る（平時には存在しない）
INSERT INTO spots (name, category, location, address, municipality, source, note) VALUES
  ('酒田市総合体育館 給水所', 'water',  ST_SetSRID(ST_MakePoint(139.8560, 38.9150), 4326), '酒田市', '酒田市', 'official', '応急給水'),
  ('鶴岡市小真木原 給水所',   'water',  ST_SetSRID(ST_MakePoint(139.8420, 38.7280), 4326), '鶴岡市', '鶴岡市', 'official', '応急給水'),
  ('新庄市民プラザ 物資配布', 'supply', ST_SetSRID(ST_MakePoint(140.3010, 38.7640), 4326), '新庄市', '新庄市', 'official', NULL),
  ('戸沢村役場 炊き出し',     'supply', ST_SetSRID(ST_MakePoint(140.1620, 38.7770), 4326), '戸沢村', '戸沢村', 'official', NULL),
  ('酒田市 災害ごみ仮置場',   'waste',  ST_SetSRID(ST_MakePoint(139.8700, 38.9050), 4326), '酒田市', '酒田市', 'official', '床上浸水の片付けごみ'),
  ('鶴岡市 災害ごみ仮置場',   'waste',  ST_SetSRID(ST_MakePoint(139.8300, 38.7100), 4326), '鶴岡市', '鶴岡市', 'official', NULL),
  ('国道47号 戸沢村付近',     'road',   ST_SetSRID(ST_MakePoint(140.1500, 38.7800), 4326), '戸沢村', '戸沢村', 'user', NULL),
  ('県道345号 酒田市浜中',    'road',   ST_SetSRID(ST_MakePoint(139.8200, 38.9300), 4326), '酒田市', '酒田市', 'user', NULL),
  ('最上川 中流域',           'lifeline', ST_SetSRID(ST_MakePoint(140.0500, 38.8000), 4326), '大蔵村', '大蔵村', 'user', 'エリアの代表点')
ON CONFLICT DO NOTHING;

-- 住民の報告。鮮度の3段階が画面上で見えるよう、経過時間をばらけさせる
INSERT INTO observations (spot_id, status, observed_at, attrs, note, reporter_token)
SELECT s.id, v.status, now() - (v.age || ' minutes')::interval, v.attrs::jsonb, v.note, 'rehearsal'
FROM spots s JOIN (VALUES
  ('酒田市総合体育館 給水所', 'active',       25,  '{"container":"required"}', '容器持参。20時まで'),
  ('鶴岡市小真木原 給水所',   'active',       80,  '{"container":"provided"}', NULL),
  ('新庄市民プラザ 物資配布', 'active',       40,  '{"items":"水・タオル・長靴"}', NULL),
  ('戸沢村役場 炊き出し',     'scheduled',    120, '{"items":"おにぎり・豚汁"}', '18時から'),
  ('酒田市 災害ごみ仮置場',   'crowded',      55,  '{"waitMinutes":"60","accepts":"畳・家具・家電"}', '搬入待ち1時間'),
  ('鶴岡市 災害ごみ仮置場',   'open',         30,  '{"waitMinutes":"10"}', NULL),
  -- 冠水は豪雨で最も効く情報。地震では出てこない
  ('国道47号 戸沢村付近',     'flooded',      20,  '{}', '冠水。通行不可'),
  ('県道345号 酒田市浜中',    'closed',       90,  '{}', '土砂で通行止め'),
  ('最上川 中流域',           'outage_water', 150, '{}', '浄水場が被災し断水'),
  -- 平時からある場所にも状況が付く
  ('第二公園',                'active',       35,  '{"container":"required"}', NULL)
) AS v(nm, status, age, attrs, note) ON s.name = v.nm;

-- 追認。「3人が同意」の表示を確認するため
INSERT INTO confirmations (observation_id, reporter_token, agrees)
SELECT o.id, t.tok, t.ag FROM observations o JOIN spots s ON s.id = o.spot_id
JOIN (VALUES
  ('国道47号 戸沢村付近', 'r1', true), ('国道47号 戸沢村付近', 'r2', true),
  ('国道47号 戸沢村付近', 'r3', true), ('酒田市総合体育館 給水所', 'r1', true),
  -- 食い違いの表示も見ておく
  ('鶴岡市 災害ごみ仮置場', 'r1', false), ('鶴岡市 災害ごみ仮置場', 'r2', false)
) AS t(nm, tok, ag) ON s.name = t.nm
ON CONFLICT DO NOTHING;

-- 団体からのお知らせ。ボランティアは豪雨の泥出しで実際に必要になる
INSERT INTO notices (kind, title, body, organization, contact, municipality, ends_at, owner_token) VALUES
  ('volunteer', '床下の泥出しを手伝ってくださる方',
   E'長靴・軍手・マスクをお持ちください。9時に現地集合。\n汚泥のため着替えを用意されることをおすすめします。',
   '酒田市社会福祉協議会 災害ボランティアセンター', '0234-00-0000', '酒田市', now() + interval '14 days', 'rehearsal'),
  ('need', 'タオルと長靴が不足しています',
   E'バスタオル50枚、長靴（25〜27cm）30足ほど。\n平日9-17時に受け取れます。',
   '△△地区自主防災会', '0235-00-0000', '鶴岡市', now() + interval '7 days', 'rehearsal'),
  ('support', '軽トラで災害ごみの運搬を手伝えます',
   '平日夕方と土日なら対応できます。まずお電話ください。',
   '□□運送', '090-0000-0000', '新庄市', now() + interval '14 days', 'rehearsal')
ON CONFLICT DO NOTHING;

-- 通報も1件積んでおく。管理画面での操作を練習するため
INSERT INTO reports (observation_id, reason, reporter_token)
SELECT o.id, '事実と違う。もう水は引いている', 'rehearsal'
FROM observations o JOIN spots s ON s.id = o.spot_id
WHERE s.name = '県道345号 酒田市浜中' LIMIT 1;

UPDATE site_state SET mode = 'disaster',
  notice = '庄内・最上を中心に大雨の被害が出ています。ご覧になった状況を報告してください。'
WHERE id = true;
