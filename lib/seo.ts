/**
 * ページごとのメタデータ。
 *
 * ── このサイトの発見経路 ──
 * イマココナビは認知ゼロから1日7万人に届いた。経路はSNSで、検索ではない。
 * 災害の初期に人が動くのはSNS。検索は「山形 給水所」のように後から効く。
 * よって OGP を最優先で整える。SEOはその次。
 *
 * ── 公式を押しのけない ──
 * 「酒田市 避難所」で市の公式より上に出ることは、それ自体が危険。
 * うちのデータが古ければ人は誤った場所へ向かう。
 * 個別スポットの薄いページを大量にインデックスさせず、
 * カテゴリ・市町村単位のページに絞る。
 */

import type { Metadata } from 'next';
import { SITE_ENV, IS_REAL, PRODUCTION_URL } from './env';

export const SITE_NAME = 'やまがた結（ゆい）';

/** ステージング・開発では検索避けを必ず付ける */
function robots(): Metadata['robots'] {
  return IS_REAL ? undefined : { index: false, follow: false };
}

function decorate(title: string): string {
  return IS_REAL
    ? title
    : `【${SITE_ENV === 'staging' ? '確認用' : '開発中'}】${title}`;
}

export function buildMetadata(opts: {
  title: string;
  description: string;
  /** 正規URL。クエリパラメータ違いで重複扱いされるのを防ぐ */
  path?: string;
  /** 個別スポットなど、薄いページはインデックスさせない */
  noindex?: boolean;
}): Metadata {
  const title = decorate(opts.title);
  const url = `${PRODUCTION_URL}${opts.path ?? '/'}`;
  return {
    title,
    description: opts.description,
    alternates: opts.path ? { canonical: url } : undefined,
    robots: opts.noindex ? { index: false, follow: true } : robots(),
    openGraph: {
      title,
      description: opts.description,
      url,
      siteName: SITE_NAME,
      locale: 'ja_JP',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: opts.description,
    },
  };
}
