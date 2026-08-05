import { query } from './db';
import type { Mode } from './categories';

export interface SpotRow {
  id: string;
  name: string;
  category: string;
  address: string | null;
  is_priority: boolean;
  note: string | null;
  /** 指定緊急避難場所が対応する災害種別。地震向けが洪水で使えるとは限らない */
  hazards: string[] | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  // 最新の観測（まだ一度も報告がなければ null）
  obs_id: string | null;
  status: string | null;
  // pg は timestamptz を Date で返し、RSC 経由でも Date のまま届く。
  // fetch 経由（/api/spots）では JSON 文字列になるため両方を受ける。
  observed_at: string | Date | null;
  attrs: Record<string, string> | null;
  obs_note: string | null;
  agrees: number;
  disagrees: number;
}

/**
 * 一覧の中核クエリ。
 *
 * LATERAL で「その場所の最新の観測を1件だけ」引く。これにより、同じ場所に何人が
 * 報告しても行は1つにまとまる（イマココナビのように投稿が並列に並ばない）。
 *
 * 並び順は現在地からの距離。位置情報が取れない場合は「最近更新された順」に落とす。
 * トップを地図ではなくリストにしているのは、災害時に地図タイルが重すぎるため
 * （DESIGN.md 5.1）。距離順のリストで「近くのどこが開いてるか」には十分答えられる。
 */
export async function findSpots(opts: {
  mode: Mode;
  categories: string[];
  lat?: number;
  lng?: number;
  municipality?: string | null;
  /**
   * いま起きている災害の種別。指定すると、対応しない避難場所を除く。
   * 「山形西高等学校（グラウンド）は地震のみ」を豪雨時に出すと、
   * 水が来る場所へ人を送ることになる。
   */
  hazard?: string | null;
  limit?: number;
}): Promise<SpotRow[]> {
  const { categories, lat, lng, municipality, hazard, limit = 50 } = opts;
  const hasLoc = typeof lat === 'number' && typeof lng === 'number';
  // パラメータ番号は hasLoc の有無でずれる。市町村は常に最後に足す。
  const muniParam = hasLoc ? 5 : 3;

  const sql = `
    SELECT
      s.id, s.name, s.category, s.address, s.is_priority, s.note, s.hazards,
      ST_Y(s.location::geometry) AS lat,
      ST_X(s.location::geometry) AS lng,
      ${hasLoc
        ? 'ST_Distance(s.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)'
        : 'NULL::double precision'} AS distance_m,
      o.id           AS obs_id,
      o.status       AS status,
      o.observed_at  AS observed_at,
      o.attrs        AS attrs,
      o.note         AS obs_note,
      -- COUNT は bigint。pg ドライバが文字列で返すため、必ず int にキャストする。
      -- ここを怠ると disagrees > agrees が文字列比較になり、食い違い判定が壊れる。
      COALESCE(cf.agrees, 0)::int    AS agrees,
      COALESCE(cf.disagrees, 0)::int AS disagrees
    FROM spots s
    LEFT JOIN LATERAL (
      SELECT o2.id, o2.status, o2.observed_at, o2.attrs, o2.note
      FROM observations o2
      WHERE o2.spot_id = s.id AND NOT o2.is_hidden
      ORDER BY o2.observed_at DESC
      LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE c.agrees)     AS agrees,
        COUNT(*) FILTER (WHERE NOT c.agrees) AS disagrees
      FROM confirmations c
      WHERE c.observation_id = o.id
    ) cf ON true
    WHERE s.is_active AND s.category = ANY($1::text[])
      ${municipality ? `AND s.municipality = $${muniParam}` : ''}
      -- 避難場所だけ災害種別で絞る。店や給水所は災害を選ばないので対象外。
      -- 種別が未登録のものは落とさない。情報が無いだけで使えないとは限らない。
      ${hazard ? `AND (s.category <> 'evacuation'
                       OR s.hazards IS NULL
                       OR cardinality(s.hazards) = 0
                       OR $${municipality ? muniParam + 1 : muniParam} = ANY(s.hazards))` : ''}
    ORDER BY
      ${hasLoc
        ? 'distance_m ASC NULLS LAST'
        // 位置情報が無いときに名前順にすると、「あ」で始まる遠い避難場所が
        // 上に来て近くの場所が埋もれる。報告があるものと優先度の高いものを先に。
        : 'o.observed_at DESC NULLS LAST, s.is_priority DESC'},
      s.name ASC
    LIMIT ${hasLoc ? '$4' : '$2'}
  `;

  const params: unknown[] = hasLoc
    ? [categories, lng, lat, limit]
    : [categories, limit];
  if (municipality) params.push(municipality);
  if (hazard) params.push(hazard);
  return query<SpotRow>(sql, params);
}

/**
 * 名前・住所での検索。
 *
 * 6,699件に増えたことで、距離順だけでは目的の場所に辿り着けなくなった。
 * 「ヤマザワ」「琢成小学校」のように名前が分かっているときは検索のほうが速い。
 *
 * 検索でもカテゴリの絞り込みとモードは効かせる。平時に「災害ごみ仮置場」が
 * 検索で出てくると、存在しないものを探しに行かせることになる。
 */
export async function searchSpots(opts: {
  q: string;
  categories: string[];
  lat?: number;
  lng?: number;
  limit?: number;
}): Promise<SpotRow[]> {
  const { q, categories, lat, lng, limit = 50 } = opts;
  const hasLoc = typeof lat === 'number' && typeof lng === 'number';
  const term = `%${q.trim().slice(0, 40)}%`;

  const sql = `
    SELECT
      s.id, s.name, s.category, s.address, s.is_priority, s.note, s.hazards,
      ST_Y(s.location::geometry) AS lat,
      ST_X(s.location::geometry) AS lng,
      ${hasLoc
        ? 'ST_Distance(s.location, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography)'
        : 'NULL::double precision'} AS distance_m,
      o.id AS obs_id, o.status, o.observed_at, o.attrs, o.note AS obs_note,
      COALESCE(cf.agrees, 0)::int AS agrees,
      COALESCE(cf.disagrees, 0)::int AS disagrees
    FROM spots s
    LEFT JOIN LATERAL (
      SELECT o2.id, o2.status, o2.observed_at, o2.attrs, o2.note
      FROM observations o2 WHERE o2.spot_id = s.id AND NOT o2.is_hidden
      ORDER BY o2.observed_at DESC LIMIT 1
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE c.agrees) AS agrees,
             COUNT(*) FILTER (WHERE NOT c.agrees) AS disagrees
      FROM confirmations c WHERE c.observation_id = o.id
    ) cf ON true
    WHERE s.is_active
      AND s.category = ANY($1::text[])
      AND (s.name ILIKE $2 OR s.address ILIKE $2)
    ORDER BY
      -- 名前の一致を住所の一致より上に。店名で探している人が多い
      (s.name ILIKE $2) DESC,
      ${hasLoc ? 'distance_m ASC NULLS LAST,' : ''}
      s.name ASC
    LIMIT $3
  `;
  const params: unknown[] = [categories, term, limit];
  if (hasLoc) params.push(lng, lat);
  return query<SpotRow>(sql, params);
}

/** 地域の絞り込みに出す選択肢。実際にスポットがある市町村だけを返す */
export async function listMunicipalities(categories: string[]): Promise<string[]> {
  const rows = await query<{ municipality: string }>(
    `SELECT DISTINCT municipality FROM spots
     WHERE is_active AND municipality IS NOT NULL AND category = ANY($1::text[])
     ORDER BY municipality`,
    [categories]
  );
  return rows.map((r) => r.municipality);
}

export interface ObservationRow {
  id: string;
  status: string;
  observed_at: string | Date;
  created_at: string | Date;
  attrs: Record<string, string>;
  note: string | null;
  agrees: number;
  disagrees: number;
}

export async function getSpot(id: string) {
  const rows = await query<{
    id: string;
    name: string;
    category: string;
    address: string | null;
    is_priority: boolean;
    note: string | null;
    hazards: string[] | null;
    lat: number;
    lng: number;
  }>(
    `SELECT id, name, category, address, is_priority, note, hazards,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM spots WHERE id = $1 AND is_active`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * 観測の履歴。「12:00 開いてた → 15:00 閉まってた」という推移が見えることが重要。
 * 削除ではなく履歴として残すことで、状況の変化そのものが情報になる。
 */
export async function getObservations(spotId: string, limit = 20) {
  return query<ObservationRow>(
    `SELECT o.id, o.status, o.observed_at, o.created_at, o.attrs, o.note,
            COALESCE(cf.agrees, 0)::int AS agrees, COALESCE(cf.disagrees, 0)::int AS disagrees
     FROM observations o
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE c.agrees) AS agrees,
              COUNT(*) FILTER (WHERE NOT c.agrees) AS disagrees
       FROM confirmations c WHERE c.observation_id = o.id
     ) cf ON true
     WHERE o.spot_id = $1 AND NOT o.is_hidden
     ORDER BY o.observed_at DESC
     LIMIT $2`,
    [spotId, limit]
  );
}

// ─────────────────────────────────────────────
// お知らせ（notices）。lib/notices.ts と db/004_notices.sql を参照。
// ─────────────────────────────────────────────

export interface NoticeRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  organization: string;
  contact: string;
  municipality: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  verified_at: string | Date | null;
  created_at: string | Date;
  owner_token?: string | null;
}

export async function findNotices(opts: { kind?: string | null; limit?: number }) {
  const { kind, limit = 50 } = opts;
  return query<NoticeRow>(
    `SELECT id, kind, title, body, organization, contact, municipality,
            starts_at, ends_at, verified_at, created_at, owner_token
     FROM notices
     WHERE NOT is_hidden
       -- 期限切れは自動で落とす。掲載しっぱなしは古い情報を配るのと同じ
       AND (ends_at IS NULL OR ends_at > now())
       -- 投稿者が「終了しました」と報告したものも落とす
       AND closed_at IS NULL
       ${kind ? 'AND kind = $2' : ''}
     ORDER BY verified_at IS NULL, created_at DESC
     LIMIT $1`,
    kind ? [limit, kind] : [limit]
  );
}

/**
 * お知らせを終了する。
 * 投稿者本人（署名付き匿名IDが一致する場合）だけが閉じられる。
 * 他人の募集を勝手に閉じられると、それ自体が妨害の手段になる。
 */
export async function closeNotice(id: string, ownerToken: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE notices SET closed_at = now()
     WHERE id = $1 AND owner_token = $2 AND closed_at IS NULL
     RETURNING id`,
    [id, ownerToken]
  );
  return rows.length > 0;
}

export async function insertNotice(input: {
  kind: string;
  title: string;
  body: string;
  organization: string;
  contact: string;
  municipality: string | null;
  endsAt: Date | null;
  ownerToken: string;
}) {
  const rows = await query<{ id: string }>(
    `INSERT INTO notices (kind, title, body, organization, contact, municipality, ends_at, owner_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.kind,
      input.title,
      input.body,
      input.organization,
      input.contact,
      input.municipality,
      input.endsAt,
      input.ownerToken,
    ]
  );
  return rows[0];
}

export async function getMode(): Promise<{
  mode: Mode;
  notice: string | null;
  hazard: string | null;
}> {
  const rows = await query<{ mode: Mode; notice: string | null; hazard: string | null }>(
    `SELECT mode, notice, hazard FROM site_state WHERE id = true`
  );
  return rows[0] ?? { mode: 'standby', notice: null, hazard: null };
}

export async function insertObservation(input: {
  spotId: string;
  status: string;
  observedAt: Date;
  attrs: Record<string, string>;
  note: string | null;
  reporterToken: string;
  ip?: string;
}) {
  const rows = await query<{ id: string }>(
    `INSERT INTO observations (spot_id, status, observed_at, attrs, note, reporter_token, ip)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     RETURNING id`,
    [
      input.spotId,
      input.status,
      input.observedAt,
      JSON.stringify(input.attrs),
      input.note,
      input.reporterToken,
      input.ip ?? null,
    ]
  );
  return rows[0];
}

// ─────────────────────────────────────────────
// スポットの追加
// ─────────────────────────────────────────────

/**
 * 近くの同カテゴリのスポット。重複登録を防ぐために使う。
 * 同じ場所が二重に立つと観測が分散し、「場所に観測が積み重なる」
 * という設計の利点がそのまま失われる。
 */
export async function findNearbySpots(
  lat: number,
  lng: number,
  category: string,
  radiusM = 120
) {
  return query<{ id: string; name: string; distance_m: number }>(
    `SELECT id, name,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
     FROM spots
     WHERE is_active AND category = $3
       AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $4)
     ORDER BY distance_m
     LIMIT 5`,
    [lat, lng, category, radiusM]
  );
}

export async function insertSpot(input: {
  name: string;
  category: string;
  lat: number;
  lng: number;
  address: string | null;
  municipality: string | null;
  note: string | null;
  ip?: string;
}) {
  const rows = await query<{ id: string }>(
    `INSERT INTO spots (name, category, location, address, municipality, note, source, created_ip)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $5, $6, $7, 'user', $8)
     RETURNING id`,
    [
      input.name,
      input.category,
      input.lat,
      input.lng,
      input.address,
      input.municipality,
      input.note,
      input.ip ?? null,
    ]
  );
  return rows[0];
}

/** 同一の発信元が短時間に場所を量産するのを止める */
export async function recentSpotCountByIp(ip: string, withinMinutes = 30) {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM spots
     WHERE created_ip = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [ip, withinMinutes]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 同一端末の二重投票は上書き（気が変わることはある） */
export async function upsertConfirmation(input: {
  observationId: string;
  agrees: boolean;
  reporterToken: string;
  ip?: string;
}) {
  await query(
    `INSERT INTO confirmations (observation_id, reporter_token, agrees, ip)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (observation_id, reporter_token)
     DO UPDATE SET agrees = EXCLUDED.agrees, created_at = now()`,
    [input.observationId, input.reporterToken, input.agrees, input.ip ?? null]
  );
}

/** cookie を作り直しても回避できない歯止め */
export async function recentConfirmationCountByIp(
  ip: string,
  withinMinutes = 10
): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM confirmations
     WHERE ip = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [ip, withinMinutes]
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * 連投の抑制。事前審査をしない代わりの最低限の防波堤（DESIGN.md 6章）。
 * 同じ端末が同じ場所に短時間で繰り返し報告するのを止める。
 */
export async function recentObservationCount(
  reporterToken: string,
  spotId: string,
  withinMinutes = 5
): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM observations
     WHERE reporter_token = $1 AND spot_id = $2
       AND created_at > now() - ($3 || ' minutes')::interval`,
    [reporterToken, spotId, withinMinutes]
  );
  return Number(rows[0]?.n ?? 0);
}

// ─────────────────────────────────────────────
// 管理用
// ─────────────────────────────────────────────

export async function setMode(mode: Mode, notice: string | null, hazard: string | null) {
  await query(
    `UPDATE site_state SET mode = $1, notice = $2, hazard = $3, updated_at = now()
     WHERE id = true`,
    [mode, notice, hazard]
  );
}

/** 通報キュー。事後補正型を採る以上、ここが唯一の人力の防波堤になる */
export async function listOpenReports() {
  return query<{
    id: string;
    reason: string;
    created_at: string | Date;
    observation_id: string | null;
    obs_note: string | null;
    obs_status: string | null;
    spot_id: string | null;
    spot_name: string | null;
    spot_category: string | null;
  }>(
    `SELECT r.id, r.reason, r.created_at, r.observation_id,
            o.note AS obs_note, o.status AS obs_status,
            s.id AS spot_id, s.name AS spot_name, s.category AS spot_category
     FROM reports r
     LEFT JOIN observations o ON o.id = r.observation_id
     LEFT JOIN spots s ON s.id = COALESCE(r.spot_id, o.spot_id)
     WHERE r.resolved_at IS NULL
     ORDER BY r.created_at DESC
     LIMIT 100`
  );
}

export async function resolveReport(id: string) {
  await query(`UPDATE reports SET resolved_at = now() WHERE id = $1`, [id]);
}

/** 緊急削除。人命に関わる誤誘導だけは能動的に消す（DESIGN.md 6章） */
export async function hideObservation(id: string) {
  await query(`UPDATE observations SET is_hidden = true WHERE id = $1`, [id]);
}

export async function listPendingNotices() {
  return query<NoticeRow>(
    `SELECT id, kind, title, body, organization, contact, municipality,
            starts_at, ends_at, verified_at, created_at
     FROM notices
     WHERE NOT is_hidden AND (ends_at IS NULL OR ends_at > now())
     ORDER BY verified_at IS NULL DESC, created_at DESC
     LIMIT 100`
  );
}

export async function verifyNotice(id: string, verified: boolean) {
  await query(
    `UPDATE notices SET verified_at = ${verified ? 'now()' : 'NULL'} WHERE id = $1`,
    [id]
  );
}

export async function hideNotice(id: string) {
  await query(`UPDATE notices SET is_hidden = true WHERE id = $1`, [id]);
}

export async function insertReport(input: {
  observationId: string | null;
  spotId: string | null;
  reason: string;
  reporterToken: string;
}) {
  await query(
    `INSERT INTO reports (observation_id, spot_id, reason, reporter_token)
     VALUES ($1, $2, $3, $4)`,
    [input.observationId, input.spotId, input.reason, input.reporterToken]
  );
}

/**
 * カテゴリごとの件数。
 * 0件のカテゴリを黙って並べると「使われていないサイト」に見える。
 * 件数を出したうえで、空の理由（発災時に生まれる / まだ誰も登録していない）を
 * 出し分けるために使う。
 */
export async function countByCategory(categories: string[]) {
  const rows = await query<{ category: string; n: number }>(
    `SELECT category, COUNT(*)::int AS n FROM spots
     WHERE is_active AND category = ANY($1::text[])
     GROUP BY category`,
    [categories]
  );
  const map: Record<string, number> = {};
  for (const c of categories) map[c] = 0;
  for (const r of rows) map[r.category] = r.n;
  return map;
}

/**
 * サーバ側の現在時刻。
 * 描画中に Date.now() を直接呼ぶと純粋でない処理になるため、データ取得側に寄せる。
 * 鮮度表示の基準値で、クライアントはマウント後に自分の時計で上書きする。
 */
export async function getServerNow(): Promise<number> {
  return Date.now();
}
