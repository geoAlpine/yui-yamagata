import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSpot, getObservations } from '@/lib/queries';
import { getCategory, getStatus, attrsForStatus } from '@/lib/categories';
import { evaluateFreshness, formatAge } from '@/lib/freshness';
import { buildMetadata, SITE_NAME } from '@/lib/seo';
import { PHOTO, thumbPath } from '@/lib/photo';
import ReportAbuse from '@/components/ReportAbuse';
import { googleMapsUrl, googleDirectionsUrl } from '@/lib/external';

export const revalidate = 60;

/**
 * 個別スポットは noindex。6,699件の薄いページをインデックスさせると
 * サイト全体の評価が下がるうえ、「酒田市 避難所」で市の公式より上に
 * 個別ページが出るのは望ましくない。SNSで共有されたときのカードは出す。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const spot = await getSpot(id);
  if (!spot) return buildMetadata({ title: SITE_NAME, description: '', noindex: true });
  const cat = getCategory(spot.category);
  return buildMetadata({
    title: `${spot.name}（${cat?.label ?? ''}）| ${SITE_NAME}`,
    description:
      `${spot.address ?? ''}${spot.name}の今の状況。` +
      '住民が実際に見た情報で、公式発表ではありません。',
    noindex: true,
  });
}

function fmtTime(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`;
}

export default async function SpotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const spot = await getSpot(id);
  if (!spot) notFound();

  const observations = await getObservations(spot.id);
  const cat = getCategory(spot.category);
  const latest = observations[0];
  const fresh = latest
    ? evaluateFreshness(spot.category, latest.observed_at)
    : null;
  const latestStatus = latest ? getStatus(spot.category, latest.status) : undefined;
  const showStatus = fresh?.showStatus && latestStatus;

  return (
    <>
      <p style={{ marginTop: 14 }}>
        <Link href="/">← 一覧にもどる</Link>
      </p>

      <h1 style={{ fontSize: 20, margin: '10px 0 4px' }}>
        {spot.name}
        {spot.is_priority && <span className="priority">自家発電</span>}
      </h1>
      <p className="sub">
        {cat?.label}
        {spot.address ? ` ・ ${spot.address}` : ''}
      </p>
      {spot.note && <p className="note">{spot.note}</p>}

      <div className="card" style={{ marginTop: 16 }}>
        {showStatus ? (
          <div className={`status ${latestStatus!.severity}`}>
            {latestStatus!.label}
          </div>
        ) : (
          <div className="status unknown">
            {latest ? '状況不明（情報が古い）' : 'まだ情報がありません'}
          </div>
        )}

        {showStatus && (
          <div className="attrs">
            {attrsForStatus(spot.category, latest.status).map((a) => {
              const v = latest.attrs?.[a.id];
              if (!v) return null;
              const label =
                a.options?.find((o) => o.value === v)?.label ?? `${v}${a.unit ?? ''}`;
              return <span key={a.id}>{label}</span>;
            })}
          </div>
        )}

        {showStatus && latest.note && <div className="note">{latest.note}</div>}

        {/*
          写真。行列や貼り紙の1枚が持つ説得力は大きい。
          EXIFは送信前に落としてあるので、撮影場所は漏れない。
        */}
        {showStatus && latest.photo_path && (
          <figure className="photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/uploads/${latest.photo_path}`}
              alt={`${spot.name}の様子`}
              loading="lazy"
            />
            <figcaption>
              住民が撮影した写真です。{PHOTO.retentionDays}日で自動的に消えます。
            </figcaption>
          </figure>
        )}

        {latest && fresh && (
          <div className="age">
            <span className={fresh.level === 'fresh' ? 'strong' : 'age-warn'}>
              {formatAge(fresh.ageMinutes)}に確認
            </span>
            <span>（{fmtTime(latest.observed_at)} 時点）</span>
            {latest.agrees > 0 && <span>{latest.agrees}人が同意</span>}
            {latest.disagrees > latest.agrees && latest.disagrees > 0 && (
              <span className="conflict">⚠ 情報が食い違っています</span>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Link className="btn primary block" href={`/report/${spot.id}`}>
            今の状況を報告する
          </Link>
        </div>
      </div>

      {/*
        平時の営業時間や混雑はGoogleのほうが正確。張り合わずに送り出す。
        うちが持つのは「住民が今見た状況」だけで、それは上のカードに出ている。
      */}
      <div className="external">
        <a href={googleDirectionsUrl(spot.lat, spot.lng)} target="_blank" rel="noopener noreferrer">
          ここへの経路を調べる
        </a>
        <a href={googleMapsUrl(spot.lat, spot.lng)} target="_blank" rel="noopener noreferrer">
          Googleで営業時間などを見る
        </a>
        <p className="sub">
          営業時間や定休日はGoogleのほうが正確です。
          このページに出ているのは、住民が実際に見た「いまの状況」だけです。
        </p>
      </div>

      {/*
        削除ではなく履歴として残す。
        「12:00 開いてた → 15:00 閉まってた」という推移そのものが情報になる（DESIGN.md 3.1）。
      */}
      <h2>これまでの報告</h2>
      {observations.length === 0 ? (
        <p className="sub">まだ報告がありません。</p>
      ) : (
        <ul className="history">
          {observations.map((o) => {
            const s = getStatus(spot.category, o.status);
            return (
              <li key={o.id}>
                <span className="t">{fmtTime(o.observed_at)}</span>
                <span className="h-body">
                  <strong style={{ color: `var(--${s?.severity ?? 'unknown'})` }}>
                    {s?.label ?? o.status}
                  </strong>
                  {o.note ? <span className="sub"> — {o.note}</span> : null}
                  {o.agrees > 0 && (
                    <span className="sub"> ・{o.agrees}人が同意</span>
                  )}
                </span>
                {/*
                  過去の報告に付いた写真も出す。
                  同じ場所に複数人が投稿したとき、最新の1枚だけ見せていたら
                  「9時は5人待ち → 11時は50人」という推移が消える。
                  写真が集まる場面こそ写真の価値が高い。

                  ここもサムネイル。原寸を履歴の数だけ並べたら詳細ページが
                  数MBになる。原寸はページ上部の最新1枚だけ。
                */}
                {o.photo_path && (
                  <a className="h-photo" href={`/uploads/${o.photo_path}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/uploads/${thumbPath(o.photo_path)}`}
                      alt={`${fmtTime(o.observed_at)}の様子`}
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 事前審査をしない以上、利用者が「おかしい」と言える口が要る */}
      <ReportAbuse observationId={latest?.id} spotId={spot.id} />

      <p className="sub" style={{ marginTop: 20 }}>
        この情報は住民の目撃情報です。公式情報ではありません。
        {cat && `（${cat.label}の情報は約${Math.round(cat.ttlMinutes / 60)}時間で「不明」に戻ります）`}
      </p>
    </>
  );
}
