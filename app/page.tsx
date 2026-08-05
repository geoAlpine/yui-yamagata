import Link from 'next/link';
import { categoriesForMode, hazardLabel, HAZARDS } from '@/lib/categories';
import {
  findSpots, searchSpots, getMode, listMunicipalities, countByCategory, getServerNow,
} from '@/lib/queries';
import SpotList from '@/components/SpotList';

// 一覧は短命キャッシュ。鮮度は分単位で足りるので秒単位の即時性は要らない。
// 本番ではこの値が Cloudflare の s-maxage と対応する（DESIGN.md 7章）。
export const revalidate = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; muni?: string; q?: string; hz?: string }>;
}) {
  const { cat, muni, q, hz } = await searchParams;
  const query = (q ?? '').trim().slice(0, 40);
  const { mode, hazard: adminHazard } = await getMode();

  /*
   * 災害種別は管理者が設定できるが、それだけに頼らない。
   *   - 当日、運営者がモード切替はしても種別の設定を忘れることはある
   *   - 運営者自身が被災している、対応前、ということもある
   *   - 複合災害では管理者は「指定しない」にせざるを得ない
   * 利用者が上書きできるようにしておく。URLに持たせるので共有もできる。
   * 平時にも効く。「うちの近くの洪水対応の避難場所はどこか」は備えそのもの。
   */
  const userHazard = hz && HAZARDS.some((h) => h.id === hz) ? hz : null;
  const clearedByUser = hz === 'all';
  const hazard = clearedByUser ? null : (userHazard ?? adminHazard);
  const cats = categoriesForMode(mode);

  const selected = cat && cats.some((c) => c.id === cat) ? cat : null;
  const targetCategories = selected ? [selected] : cats.map((c) => c.id);

  const counts = await countByCategory(cats.map((c) => c.id));
  // 避難場所を表示しうる場面でだけ、災害種別の選択を出す
  const catsHaveShelter = targetCategories.includes('evacuation');
  const municipalities = await listMunicipalities(targetCategories);
  const selectedMuni = muni && municipalities.includes(muni) ? muni : null;

  // 検索は距離順より優先する。名前が分かっているなら、それが最短経路
  const spots = query
    ? await searchSpots({ q: query, categories: targetCategories, limit: 50 })
    : await findSpots({
        mode,
        categories: targetCategories,
        municipality: selectedMuni,
        hazard,
        limit: 50,
      });
  const serverNow = await getServerNow();

  // 災害種別の切り替えリンク。'all' は「絞り込まない」を明示する値
  const hzUrl = (id: string) => {
    const p = new URLSearchParams();
    if (selected) p.set('cat', selected);
    if (selectedMuni) p.set('muni', selectedMuni);
    if (query) p.set('q', query);
    p.set('hz', id);
    return `/?${p.toString()}`;
  };

  const qs = (over: { cat?: string | null; muni?: string | null }) => {
    const p = new URLSearchParams();
    const c = over.cat === undefined ? selected : over.cat;
    const m = over.muni === undefined ? selectedMuni : over.muni;
    if (c) p.set('cat', c);
    if (m) p.set('muni', m);
    if (query) p.set('q', query);
    if (hz) p.set('hz', hz);
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

      {/*
        検索。GETフォームなのでJSが落ちても動く。
        6,699件になり、距離順に50件めくるより名前で引くほうが速い場面が増えた。
      */}
      <form className="search" action="/" method="get">
        {selected && <input type="hidden" name="cat" value={selected} />}
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="店名・施設名・住所で探す"
          aria-label="検索"
          enterKeyHint="search"
        />
        <button type="submit">探す</button>
      </form>

      {query && (
        <p className="search-result">
          「{query}」の検索結果 {spots.length}件
          {spots.length >= 50 && '（多いため50件まで）'}
          <a href={qs({ cat: selected }).replace(/[?&]q=[^&]*/, '') || '/'}>検索をやめる</a>
        </p>
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

      {/*
        災害種別の選択。
        管理者が設定していればそれが既定になり、利用者はここで上書きできる。
        「避難場所だから安全」は成り立たない。地震向けに指定された場所は
        豪雨では水が来る。どの災害に備えるかを選べることが要る。
      */}
      {(hazard || mode === 'disaster' || catsHaveShelter) && (
        <>
          <div className="chiprow">
            <nav className="cats muni" aria-label="災害の種類">
              <Link className={`cat${hazard ? '' : ' on'}`} href={hzUrl('all')}>
                すべて
              </Link>
              {HAZARDS.map((h) => (
                <Link
                  key={h.id}
                  className={`cat${hazard === h.id ? ' on' : ''}`}
                  href={hzUrl(h.id)}
                >
                  {h.label}
                </Link>
              ))}
            </nav>
          </div>

          {hazard ? (
            <p className="hazard-filter">
              <strong>{hazardLabel(hazard)}に対応する避難場所</strong>だけを表示しています。
              対応していない場所は、この災害では安全とは限らないため出していません。
              {adminHazard === hazard && !userHazard && '（いま起きている災害として設定されています）'}
            </p>
          ) : (
            <p className="sub" style={{ margin: '6px 0 0' }}>
              災害の種類を選ぶと、その災害に対応する避難場所だけを表示します。
              <strong>地震向けに指定された場所は、豪雨では水が来ることがあります。</strong>
            </p>
          )}
        </>
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
          避難場所・避難所は{' '}
          <a href="https://hinanmap.gsi.go.jp/index.html">
            国土地理院「指定緊急避難場所・指定避難所データ」
          </a>
          をもとにしています。
          <strong>
            最新でない場合や未掲載の場合があります。最新かつ詳細な状況は必ず市町村にご確認ください。
          </strong>
          「指定緊急避難場所」は発災時に緊急で逃げる場所で、
          <strong>災害種別ごとに指定されています</strong>。
          「避難所」は災害後に滞在する場所で、別のものです。
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
