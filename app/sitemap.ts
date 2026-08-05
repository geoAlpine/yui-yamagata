import type { MetadataRoute } from 'next';
import { categoriesForMode } from '@/lib/categories';
import { getMode, listMunicipalities } from '@/lib/queries';
import { IS_REAL, PRODUCTION_URL } from '@/lib/env';

// 実行時に評価する。ステージングのビルド成果物を本番に配ったとき、
// 中身が焼き付いていると誤ったURLを申告することになる（robots.txt で踏んだ）。
export const dynamic = 'force-dynamic';

/**
 * 載せるのは「カテゴリ」と「市町村×カテゴリ」まで。
 *
 * 個別スポット6,699件は載せない。
 *   - 薄いページを大量にインデックスさせるとサイト全体の評価が下がる
 *   - 「酒田市 避難所」で市の公式より個別ページが上に出るのは望ましくない。
 *     うちのデータが古ければ、人を誤った場所へ向かわせる
 *
 * 実際に打たれるのは「酒田市 給水所」のような組み合わせなので、
 * そこに対応するURLを申告すれば足りる。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!IS_REAL) return [];

  const { mode } = await getMode();
  const cats = categoriesForMode(mode);
  const munis = await listMunicipalities(cats.map((c) => c.id));
  const now = new Date();

  const urls: MetadataRoute.Sitemap = [
    { url: PRODUCTION_URL, lastModified: now, priority: 1 },
    { url: `${PRODUCTION_URL}/notices`, lastModified: now, priority: 0.6 },
    // 運営者と免責。検索から直接来た人が「誰が出している情報か」に
    // 辿り着けるようにする。自治体の公式と取り違えられるのを避けたい
    { url: `${PRODUCTION_URL}/about`, lastModified: now, priority: 0.5 },
  ];

  for (const c of cats) {
    urls.push({
      url: `${PRODUCTION_URL}/?cat=${c.id}`,
      lastModified: now,
      priority: 0.8,
    });
    for (const m of munis) {
      urls.push({
        url: `${PRODUCTION_URL}/?cat=${c.id}&muni=${encodeURIComponent(m)}`,
        lastModified: now,
        priority: 0.7,
      });
    }
  }
  return urls;
}
