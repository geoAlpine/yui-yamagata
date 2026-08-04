-- 開発用シードデータ
--
-- ⚠️ 座標は山形市周辺の「おおよその位置」であり、実在店舗の正確な位置ではない。
--    距離ソートと鮮度表示の動作確認のための仮データ。
--    Phase 0 の実データ投入は DESIGN.md 8章のとおり、
--    OpenStreetMap / 経産省「住民拠点SS」リスト / 各市町村の給水拠点から行う。

TRUNCATE spots RESTART IDENTITY CASCADE;

INSERT INTO spots (name, category, location, address, source, is_priority, note) VALUES
-- ── ガソリンスタンド（山形市中心部〜郊外）
('山形中央SS（仮）',      'gas',   ST_SetSRID(ST_MakePoint(140.3396, 38.2554), 4326), '山形市旅篭町',   'imported', true,  '自家発電設備あり（住民拠点SS想定）'),
('七日町SS（仮）',        'gas',   ST_SetSRID(ST_MakePoint(140.3372, 38.2530), 4326), '山形市七日町',   'imported', false, NULL),
('嶋SS（仮）',            'gas',   ST_SetSRID(ST_MakePoint(140.3208, 38.2820), 4326), '山形市嶋北',     'imported', false, NULL),
('南館SS（仮）',          'gas',   ST_SetSRID(ST_MakePoint(140.3300, 38.2280), 4326), '山形市南館',     'imported', true,  '自家発電設備あり（住民拠点SS想定）'),
('天童東SS（仮）',        'gas',   ST_SetSRID(ST_MakePoint(140.3780, 38.3620), 4326), '天童市',         'imported', false, NULL),

-- ── スーパー・コンビニ
('ヤマザワ 山形北店（仮）', 'store', ST_SetSRID(ST_MakePoint(140.3350, 38.2760), 4326), '山形市宮町',     'imported', false, NULL),
('ヤマザワ 南館店（仮）',   'store', ST_SetSRID(ST_MakePoint(140.3320, 38.2300), 4326), '山形市南館',     'imported', false, NULL),
('スーパー七日町（仮）',   'store', ST_SetSRID(ST_MakePoint(140.3380, 38.2545), 4326), '山形市七日町',   'imported', false, NULL),
('コンビニ山形駅前（仮）', 'store', ST_SetSRID(ST_MakePoint(140.3283, 38.2404), 4326), '山形市香澄町',   'imported', false, '24時間営業'),
('スーパー嶋（仮）',       'store', ST_SetSRID(ST_MakePoint(140.3190, 38.2850), 4326), '山形市嶋北',     'imported', false, NULL),

-- ── 給水所（配水池・浄水場・公園などを想定）
('松原浄水場（仮）',       'water', ST_SetSRID(ST_MakePoint(140.3600, 38.2500), 4326), '山形市松原',     'official', false, '市指定の応急給水拠点を想定'),
('霞城公園 給水拠点（仮）', 'water', ST_SetSRID(ST_MakePoint(140.3300, 38.2530), 4326), '山形市霞城町',   'official', false, NULL),
('南沼原小学校（仮）',     'water', ST_SetSRID(ST_MakePoint(140.3150, 38.2350), 4326), '山形市南原町',   'official', false, NULL),

-- ── トイレ・入浴（温浴施設。断水時の入浴先として実効性が高い）
('蔵王温泉 共同浴場（仮）', 'toilet', ST_SetSRID(ST_MakePoint(140.4000, 38.1700), 4326), '山形市蔵王温泉', 'imported', false, '温泉。断水時の入浴先'),
('天童温泉 公衆浴場（仮）', 'toilet', ST_SetSRID(ST_MakePoint(140.3800, 38.3600), 4326), '天童市鎌田',     'imported', false, '温泉。断水時の入浴先'),
('市民会館 トイレ（仮）',   'toilet', ST_SetSRID(ST_MakePoint(140.3410, 38.2480), 4326), '山形市小白川町', 'official', false, NULL),

-- ── 物資配布・炊き出し
('山形市総合体育館（仮）',  'supply', ST_SetSRID(ST_MakePoint(140.3050, 38.2650), 4326), '山形市落合町',   'official', false, NULL),
('公民館 中央（仮）',       'supply', ST_SetSRID(ST_MakePoint(140.3390, 38.2560), 4326), '山形市旅篭町',   'official', false, NULL),

-- ── 断水・停電（エリア代表点）
('山形市中心部（仮）',      'lifeline', ST_SetSRID(ST_MakePoint(140.3370, 38.2520), 4326), '山形市中心部', 'user', false, 'エリアの代表点'),
('山形市北部（仮）',        'lifeline', ST_SetSRID(ST_MakePoint(140.3300, 38.2900), 4326), '山形市北部',   'user', false, 'エリアの代表点'),

-- ── 道路（災害モード）
('国道13号 山形北IC付近（仮）', 'road', ST_SetSRID(ST_MakePoint(140.3250, 38.2950), 4326), '山形市', 'user', false, NULL),
('国道112号 西バイパス（仮）',  'road', ST_SetSRID(ST_MakePoint(140.3000, 38.2500), 4326), '山形市', 'user', false, NULL),

-- ── 雪モード用（平時）
('国道13号 天童バイパス（仮）', 'snow_clear',   ST_SetSRID(ST_MakePoint(140.3700, 38.3400), 4326), '天童市',     'user', false, NULL),
('県道19号 蔵王温泉線（仮）',   'snow_clear',   ST_SetSRID(ST_MakePoint(140.3800, 38.2000), 4326), '山形市',     'user', false, '勾配あり。冬季要注意'),
('山形駅前通り（仮）',          'snow_clear',   ST_SetSRID(ST_MakePoint(140.3290, 38.2420), 4326), '山形市香澄町', 'user', false, NULL),
('西蔵王高原ライン（仮）',      'road_surface', ST_SetSRID(ST_MakePoint(140.3600, 38.2700), 4326), '山形市',     'user', false, 'アイスバーン多発区間'),
('国道286号 笹谷峠（仮）',      'road_winter',  ST_SetSRID(ST_MakePoint(140.4500, 38.1900), 4326), '山形市',     'user', false, '冬季通行止めの可能性'),
('雪下ろし 山形中央（仮）',     'roof_snow',     ST_SetSRID(ST_MakePoint(140.3400, 38.2500), 4326), '山形市',     'user', false, NULL);
