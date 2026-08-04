import Link from 'next/link';
import { NOTICE_KINDS, getNoticeKind } from '@/lib/notices';
import { findNotices } from '@/lib/queries';
import { getOrIssueIdentity } from '@/lib/identity';
import CloseNotice from '@/components/CloseNotice';

// 投稿者本人にだけ「終了しました」を出すため cookie を読む。
// この分キャッシュは効かないが、お知らせは一覧ほど負荷が高くないので許容する。
export const dynamic = 'force-dynamic';

function fmtDate(d: string | Date | null) {
  if (!d) return null;
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getMonth() + 1}/${x.getDate()}`;
}

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const selected = kind && getNoticeKind(kind) ? kind : null;
  const notices = await findNotices({ kind: selected });
  const { id: viewerId } = await getOrIssueIdentity();

  return (
    <>
      <h1 className="page-title">お知らせ</h1>

      <div className="chiprow">
      <nav className="cats" aria-label="種類">
        <Link className={`cat${selected ? '' : ' on'}`} href="/notices">
          すべて
        </Link>
        {NOTICE_KINDS.map((k) => (
          <Link
            key={k.id}
            className={`cat${selected === k.id ? ' on' : ''}`}
            href={`/notices?kind=${k.id}`}
          >
            {k.label}
          </Link>
        ))}
      </nav>
      </div>

      <p className="sub" style={{ margin: '4px 0 12px' }}>
        団体・拠点からのお知らせです。連絡先の記載を必須にしています。
        <br />
        「確認済み」が付いていないものは、運営側で連絡先の実在を確認できていません。
      </p>

      {notices.length === 0 ? (
        <p className="empty">
          今は掲載されているお知らせがありません。
          <br />
          <Link href="/notices/new">団体・拠点の方はこちらから投稿できます</Link>
        </p>
      ) : (
        notices.map((n) => {
          const k = getNoticeKind(n.kind);
          const until = fmtDate(n.ends_at);
          return (
            <article className="card" key={n.id}>
              <div className="card-head">
                <span className="card-name">{n.title}</span>
              </div>
              <div className="attrs">
                <span>{k?.label}</span>
                {n.municipality && <span>{n.municipality}</span>}
                {until && <span>{until}まで</span>}
              </div>
              <p className="note" style={{ whiteSpace: 'pre-wrap' }}>
                {n.body}
              </p>
              <div className="age">
                <span className="strong">{n.organization}</span>
                <span>{n.contact}</span>
                {n.verified_at ? (
                  <span className="verified">確認済み</span>
                ) : (
                  <span className="unverified">未確認</span>
                )}
              </div>
              {n.owner_token && n.owner_token === viewerId && (
                <CloseNotice id={n.id} />
              )}
            </article>
          );
        })
      )}

      <div style={{ marginTop: 22 }}>
        <Link className="btn block" href="/notices/new">
          団体・拠点としてお知らせを出す
        </Link>
      </div>

      <div className="official-links">
        <strong>ボランティアをお考えの方へ</strong>
        <br />
        まず市町村の災害ボランティアセンターにご相談ください。
        <br />
        <a href="https://www.pref.yamagata.jp/020070/kurashi/bousaivolunteer.html">
          山形県 災害ボランティア情報
        </a>
      </div>
    </>
  );
}
