import Link from 'next/link';
import { myObservations } from '@/lib/queries';
import { getOrIssueIdentity } from '@/lib/identity';
import { getCategory, getStatus } from '@/lib/categories';
import { buildMetadata, SITE_NAME } from '@/lib/seo';
import WithdrawButton from '@/components/WithdrawButton';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: `自分の報告 | ${SITE_NAME}`,
  description: 'この端末から出した報告の一覧。間違えたものは取り消せます。',
  noindex: true,
});

function fmt(d: string | Date) {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}

export default async function MinePage() {
  const { id } = await getOrIssueIdentity();
  const rows = await myObservations(id);

  return (
    <>
      <h1 className="page-title">自分の報告</h1>
      <p className="tagline">
        この端末から出した報告です。間違えたものは取り消せます。
      </p>

      {rows.length === 0 ? (
        <p className="empty">
          まだ報告がありません。
          <br />
          <span className="sub">
            場所のカードから「今の状況を報告する」で投稿できます。
          </span>
        </p>
      ) : (
        rows.map((o) => {
          const cat = getCategory(o.category);
          const st = getStatus(o.category, o.status);
          const gone = !!o.withdrawn_at;
          return (
            <article className={`card${gone ? ' is-stale' : ''}`} key={o.id}>
              <div className="card-head">
                <Link className="card-name" href={`/spots/${o.spot_id}`}>
                  {o.spot_name}
                </Link>
              </div>
              <div className="statusline">
                {cat && <span className="cat-badge">{cat.short}</span>}
                <span className={`status ${gone ? 'unknown' : (st?.severity ?? 'unknown')}`}>
                  {gone ? '取り消し済み' : (st?.label ?? o.status)}
                </span>
              </div>
              {o.note && <div className="note">{o.note}</div>}
              <div className="age">
                <span>{fmt(o.observed_at)} 時点</span>
              </div>
              {!gone && <WithdrawButton id={o.id} />}
            </article>
          );
        })
      )}

      <p className="sub" style={{ marginTop: 22 }}>
        この一覧はこの端末からの報告だけを表示します。
        ログインを求めない仕組みのため、端末を変えると見られません。
        <br />
        取り消しても履歴からは消えません。
        「12時は開いていた、15時は閉まっていた」という推移そのものが情報になるためです。
      </p>
    </>
  );
}
