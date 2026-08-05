import Link from 'next/link';
import { categoriesForMode } from '@/lib/categories';
import { findSpots, searchSpots, getMode, getServerNow } from '@/lib/queries';
import { buildMetadata, SITE_NAME } from '@/lib/seo';
import ReportPicker from '@/components/ReportPicker';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: `状況を報告する | ${SITE_NAME}`,
  description: '見かけた状況を報告する場所を探します。',
  noindex: true,
});

/**
 * 報告する場所を探す画面。
 *
 * これまでは一覧のカード下部の小さなボタンからしか報告できなかった。
 * 災害時にこのサイトの価値を作るのは投稿なのに、入口が一番目立たない
 * 場所にあった。下部タブから直接入れるようにする。
 *
 * 種類で絞りながら探す形にした。「ガソリンの行列を報告したい」なら
 * 種類を選んでから近い順に見るのが最短。
 */
export default async function ReportIndex({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string }>;
}) {
  const { cat, q } = await searchParams;
  const query = (q ?? '').trim().slice(0, 40);
  const { mode } = await getMode();
  const cats = categoriesForMode(mode);
  const selected = cat && cats.some((c) => c.id === cat) ? cat : null;
  const target = selected ? [selected] : cats.map((c) => c.id);

  const spots = query
    ? await searchSpots({ q: query, categories: target, limit: 40 })
    : await findSpots({ mode, categories: target, limit: 40 });

  return (
    <>
      <h1 className="page-title">状況を報告する</h1>
      <p className="tagline">どこの状況を報告しますか？</p>

      <form className="search" action="/report" method="get">
        {selected && <input type="hidden" name="cat" value={selected} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="店名・施設名・住所で探す"
          aria-label="場所を探す"
          enterKeyHint="search"
        />
        <button type="submit">探す</button>
      </form>

      <div className="chiprow">
        <nav className="cats" aria-label="種類">
          <Link className={`cat${selected ? '' : ' on'}`} href="/report">
            すべて
          </Link>
          {cats.map((c) => (
            <Link
              key={c.id}
              className={`cat${selected === c.id ? ' on' : ''}`}
              href={`/report?cat=${c.id}${query ? `&q=${encodeURIComponent(query)}` : ''}`}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      </div>

      <ReportPicker
        initialSpots={spots}
        categories={target}
        serverNow={await getServerNow()}
      />

      {/*
        探して見つからないときの逃げ道。
        「無いから報告できない」で終わらせない。
      */}
      <div style={{ marginTop: 18 }}>
        <Link className="btn block" href="/spots/new">
          ここに無い場所を追加する
        </Link>
      </div>
    </>
  );
}
