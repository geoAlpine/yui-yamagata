import type { MetadataRoute } from 'next';
import { IS_REAL, PRODUCTION_URL } from '@/lib/env';

/**
 * ★必ず実行時に評価する。
 *
 * 既定では robots.txt はビルド時に静的生成される。そうすると
 * 「ステージングでビルドした成果物を本番に配ると、本番が Disallow: / になる」
 * という事故が起きる。しかも気づくのは検索結果から消えた数週間後になる。
 * 環境変数で振る舞いを変えるものは、ビルド時ではなく実行時に読ませる。
 */
export const dynamic = 'force-dynamic';

/**
 * ステージングと開発環境は検索エンジンに載せない。
 * 災害時に「やまがた結」で検索した人がステージングを踏むと、
 * テストデータを本物の生活情報として読んでしまう。
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_REAL) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/spots/', '/report/'] }],
    sitemap: `${PRODUCTION_URL}/sitemap.xml`,
  };
}
