import Link from 'next/link';
import { categoriesForMode } from '@/lib/categories';
import {
  findSpots, getMode, listMunicipalities, countByCategory, getServerNow,
} from '@/lib/queries';
import SpotList from '@/components/SpotList';

// 一覧は短命キャッシュ。鮮度は分単位で足りるので秒単位の即時性は要らない。
// 本番ではこの値が Cloudflare の s-maxage と対応する（DESIGN.md 7章）。
export const revalidate = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; muni?: string }>;
}) {
  const { cat, muni } = await searchParams;
  const { mode } = await getMode();
  const cats = categoriesForMode(mode);

  const selected = cat && cats.some((c) => c.id === cat) ? cat : null;
  const targetCategories = selected ? [selected] : cats.map((c) => c.id);

  const counts = await countByCategory(cats.map((c) => c.id));
  const municipalities = await listMunicipalities(targetCategories);
  const selectedMuni = muni && municipalities.includes(muni) ? muni : null;

  const spots = await findSpots({
    mode,
    categories: targetCategories,
    municipality: selectedMuni,
    limit: 50,
  });
  const serverNow = await getServerNow();

  const qs = (over: { cat?: string | null; muni?: string | null }) => {
    const p = new URLSearchParams();
    const c = over.cat === undefined ? selected : over.cat;
    const m = over.muni === undefined ? selectedMuni : over.muni;
    if (c) p.set('cat', c);
    if (m) p.set('muni', m);
    const s = p.toString();
    return s ? `/?${s}` : '/';
  };

  return (
    <>
      <h1 className="page-title">
        やまがた結<span className="yomi">（ゆい）</span>
      </h1>
      <p className="tagline">
        {mode === 'disaster'
          ? '開いてる店・給水所の今を、見た人が報告し合う'
          : '災害に備えて、近くの給水所や給油所を確かめておく'}
      </p>

      {/*
        平時に「今どこが開いてるか」は出さない。営業状況はGoogleのほうが正確で、
        中途半端に出すとかえって信頼を損なう。
        平時に見せるのはGoogleが持っていない情報（応急給水拠点・自家発電付き給油所）だけ。
      */}
      {mode !== 'disaster' && (
        <div className="standby-note">
          <strong>いまは平時です。</strong>
          災害が起きるまで、ここは「そなえ」の地図です。
          停電しても給油できる給油所や、断水したときの給水所の場所を、
          いまのうちに確かめておいてください。
          <br />
          <span className="sub">
            災害が起きると、営業中の店・物資配布・断水などの報告を受け付ける画面に切り替わります。
          </span>
        </div>
      )}

      <div className="chiprow">
      <nav className="cats" aria-label="種類">
        <Link className={`cat${selected ? '' : ' on'}`} href={qs({ cat: null })}>
          すべて
        </Link>
        {cats.map((c) => (
          <Link
            key={c.id}
            className={`cat${selected === c.id ? ' on' : ''}`}
            href={qs({ cat: c.id })}
          >
            {c.label}
            {/* 件数を出す。0件を黙って並べると「使われていないサイト」に見える */}
            {counts[c.id] > 0 ? (
              <span className="n">{counts[c.id]}</span>
            ) : (
              <span className="n zero">0</span>
            )}
          </Link>
        ))}
      </nav>
      </div>

      {/*
        地域の絞り込み。山形県は35市町村あり、県全域の一覧は災害時に長すぎる。
        逆ジオコーディングの外部APIには依存しない（災害時に落ちるものに頼らない）。
      */}
      {municipalities.length > 1 && (
        <div className="chiprow">
        <nav className="cats muni" aria-label="地域">
          <Link
            className={`cat${selectedMuni ? '' : ' on'}`}
            href={qs({ muni: null })}
          >
            全域
          </Link>
          {municipalities.map((m) => (
            <Link
              key={m}
              className={`cat${selectedMuni === m ? ' on' : ''}`}
              href={qs({ muni: m })}
            >
              {m}
            </Link>
          ))}
        </nav>
        </div>
      )}

      <SpotList
        initialSpots={spots}
        categories={targetCategories}
        serverNow={serverNow}
        emptyCategory={selected ?? null}
      />

      {/*
        避難所・河川水位・気象警報は作らない。既存のより信頼できる情報源があり、
        二重管理は誤情報の元になる（DESIGN.md 1章）。リンクするに留める。
      */}
      <div className="official-links">
        <strong>公式情報はこちら</strong>
        <br />
        <a href="https://www.pref.yamagata.jp/020072/bosai/kochibou/index.html">
          こちら防災やまがた！（山形県）
        </a>
        <br />
        <a href="http://www.kasen.pref.yamagata.jp/">山形県 河川・砂防情報</a>
        <br />
        <a href="https://www.mlit.go.jp/river/bousai/bousai-portal/index.html">
          国土交通省 防災ポータル
        </a>
        <br />
        <a href="https://www.hinanjyo.jp/">全国避難所ガイド（避難所情報）</a>

        {/*
          ODbL 1.0 は出典表示を求めている。取り込みデータを使う限り、
          この表記を消してはいけない（scripts/import_osm.mjs 参照）。
        */}
        <p style={{ marginTop: 18 }}>
          店舗・施設の位置情報には{' '}
          <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>{' '}
          のデータを利用しています。© OpenStreetMap contributors（ODbL 1.0）
          <br />
          給水所は{' '}
          <a href="https://suidou.yamagata.yamagata.jp/soshiki/2/1315.html">
            山形市上下水道部「拠点給水所マップ」
          </a>{' '}
          をもとにしています（震度5弱以上の地震で開設）。
          <br />
          営業状況・混雑などの情報は利用者の報告によるもので、施設側が発表したものではありません。
        </p>
      </div>
    </>
  );
}
