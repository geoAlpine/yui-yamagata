import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdmin, checkPassword, issueAdminCookie, ADMIN_COOKIE } from '@/lib/admin';
import { getCategory, getStatus } from '@/lib/categories';
import {
  getMode, setMode, listOpenReports, resolveReport, hideObservation,
  listPendingNotices, verifyNotice, hideNotice,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

// Server Actions で完結させる。管理画面のためにクライアントJSを増やさない。

async function login(formData: FormData) {
  'use server';
  const pw = String(formData.get('password') ?? '');
  if (!checkPassword(pw)) redirect('/admin?e=1');
  const c = issueAdminCookie();
  (await cookies()).set({
    name: c.name, value: c.value, httpOnly: true, sameSite: 'lax',
    path: '/', maxAge: c.maxAge, secure: process.env.NODE_ENV === 'production',
  });
  redirect('/admin');
}

async function logout() {
  'use server';
  (await cookies()).delete(ADMIN_COOKIE);
  redirect('/admin');
}

async function guard() {
  if (!(await isAdmin())) throw new Error('unauthorized');
}

async function actSetMode(formData: FormData) {
  'use server';
  await guard();
  const mode = String(formData.get('mode')) === 'disaster' ? 'disaster' : 'snow';
  const notice = String(formData.get('notice') ?? '').trim().slice(0, 200) || null;
  await setMode(mode, notice);
  revalidatePath('/');
  revalidatePath('/admin');
}

async function actResolve(formData: FormData) {
  'use server';
  await guard();
  await resolveReport(String(formData.get('id')));
  revalidatePath('/admin');
}

async function actHideObs(formData: FormData) {
  'use server';
  await guard();
  await hideObservation(String(formData.get('id')));
  await resolveReport(String(formData.get('reportId')));
  revalidatePath('/');
  revalidatePath('/admin');
}

async function actVerify(formData: FormData) {
  'use server';
  await guard();
  await verifyNotice(String(formData.get('id')), formData.get('v') === '1');
  revalidatePath('/notices');
  revalidatePath('/admin');
}

async function actHideNotice(formData: FormData) {
  'use server';
  await guard();
  await hideNotice(String(formData.get('id')));
  revalidatePath('/notices');
  revalidatePath('/admin');
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;

  if (!(await isAdmin())) {
    return (
      <>
        <h2>管理</h2>
        {e && <p style={{ color: 'var(--bad)', fontWeight: 700 }}>パスワードが違います</p>}
        <form action={login}>
          <div className="field">
            <label htmlFor="pw">パスワード</label>
            <input id="pw" name="password" type="password" autoComplete="current-password" />
          </div>
          <button className="btn primary block" type="submit">ログイン</button>
        </form>
      </>
    );
  }

  const [{ mode, notice }, reports, notices] = await Promise.all([
    getMode(), listOpenReports(), listPendingNotices(),
  ]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <h2 style={{ margin: 0, flex: 1 }}>管理</h2>
        <form action={logout}><button className="btn-sm" type="submit">ログアウト</button></form>
      </div>

      {/* ── モード切替 ─────────────────────────── */}
      <h2>モード</h2>
      <p className="sub">
        自動切替はしません。誤って災害モードに入ると、それ自体が信頼を失う原因になります。
      </p>
      <form action={actSetMode} className="card">
        <div className="field">
          <label>現在: <strong>{mode === 'disaster' ? '災害モード' : '平時（雪）モード'}</strong></label>
          <div className="chips" style={{ marginTop: 8 }}>
            <label className="chip">
              <input type="radio" name="mode" value="snow" defaultChecked={mode === 'snow'} /> 平時（雪）
            </label>
            <label className="chip">
              <input type="radio" name="mode" value="disaster" defaultChecked={mode === 'disaster'} /> 災害
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="notice">全ページ上部の告知（空で消す）</label>
          <input id="notice" name="notice" type="text" defaultValue={notice ?? ''} maxLength={200} />
        </div>
        <button className="btn primary" type="submit">切り替える</button>
      </form>

      {/* ── 通報キュー ─────────────────────────── */}
      <h2>通報キュー（{reports.length}件）</h2>
      <p className="sub">
        事前審査をしない設計なので、ここが唯一の人力の防波堤です。災害モード中は1日数回見てください。
      </p>
      {reports.length === 0 ? (
        <p className="sub">未対応の通報はありません。</p>
      ) : (
        reports.map((r) => {
          const cat = r.spot_category ? getCategory(r.spot_category) : null;
          const st = r.spot_category && r.obs_status
            ? getStatus(r.spot_category, r.obs_status) : null;
          return (
            <article className="card" key={r.id}>
              <div className="card-head">
                <span className="card-name">
                  {cat && <span className="cat-badge">{cat.short}</span>} {r.spot_name ?? '(場所不明)'}
                </span>
              </div>
              {st && <div className={`status ${st.severity}`}>{st.label}</div>}
              {r.obs_note && <div className="note">{r.obs_note}</div>}
              <div className="attrs"><span>通報理由: {r.reason}</span></div>
              <div className="confirm">
                {r.observation_id && (
                  <form action={actHideObs}>
                    <input type="hidden" name="id" value={r.observation_id} />
                    <input type="hidden" name="reportId" value={r.id} />
                    <button className="btn-sm no" type="submit">この報告を非表示にする</button>
                  </form>
                )}
                <form action={actResolve}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn-sm" type="submit">問題なし</button>
                </form>
              </div>
            </article>
          );
        })
      )}

      {/* ── お知らせの確認 ─────────────────────── */}
      <h2>お知らせの確認（{notices.length}件）</h2>
      <p className="sub">
        連絡先に実際に連絡が取れたものだけ「確認済み」にしてください。団体名は自称です。
      </p>
      {notices.map((n) => (
        <article className="card" key={n.id}>
          <div className="card-head">
            <span className="card-name">{n.title}</span>
            {n.verified_at ? (
              <span className="verified">確認済み</span>
            ) : (
              <span className="unverified">未確認</span>
            )}
          </div>
          <p className="note" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
          <div className="age">
            <span className="strong">{n.organization}</span>
            <span>{n.contact}</span>
          </div>
          <div className="confirm">
            <form action={actVerify}>
              <input type="hidden" name="id" value={n.id} />
              <input type="hidden" name="v" value={n.verified_at ? '0' : '1'} />
              <button className="btn-sm yes" type="submit">
                {n.verified_at ? '確認済みを外す' : '確認済みにする'}
              </button>
            </form>
            <form action={actHideNotice}>
              <input type="hidden" name="id" value={n.id} />
              <button className="btn-sm no" type="submit">非表示</button>
            </form>
          </div>
        </article>
      ))}
    </>
  );
}
