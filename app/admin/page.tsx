import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdmin, checkPassword, issueAdminCookie, needsAdminSetup, ADMIN_COOKIE } from '@/lib/admin';
import { getCategory, getStatus } from '@/lib/categories';
import {
  getMode, setMode, listOpenReports, resolveReport, hideObservation,
  listPendingNotices, verifyNotice, hideNotice, setAdminPassword, hasAdminPassword,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** 画面に出す短い理由。パスワードそのものの手がかりは出さない */
const ERRORS: Record<string, string> = {
  short: `パスワードが短すぎます`,
  mismatch: '2つのパスワードが一致しません',
  taken: '別の操作で先に設定されました。設定したパスワードでログインしてください',
  curwrong: '現在のパスワードが違います',
  pwok: 'パスワードを変更しました',
};

// Server Actions で完結させる。管理画面のためにクライアントJSを増やさない。

async function setCookie() {
  const c = issueAdminCookie();
  (await cookies()).set({
    name: c.name, value: c.value, httpOnly: true, sameSite: 'lax',
    path: '/', maxAge: c.maxAge, secure: process.env.NODE_ENV === 'production',
  });
}

async function login(formData: FormData) {
  'use server';
  const pw = String(formData.get('password') ?? '');
  if (!(await checkPassword(pw))) redirect('/admin?e=1');
  await setCookie();
  redirect('/admin');
}

/** パスワードの要件。短いものを受けると初期設定の意味が薄れる */
const MIN_PW = 12;

/**
 * 初回のパスワード設定。
 *
 * 認証を要求できない（まだパスワードが無い）ので、条件はサーバ側で必ず確認する。
 * 画面を出した時点と送信した時点の間に誰かが設定している可能性があるため、
 * onlyIfUnset を付けて「未設定のときだけ書く」を DB の条件に載せる。
 * 二人が同時に開いても、先に設定したほうが勝つ。
 */
async function setupPassword(formData: FormData) {
  'use server';
  if (!(await needsAdminSetup())) redirect('/admin');

  const pw = String(formData.get('password') ?? '');
  const pw2 = String(formData.get('password2') ?? '');
  if (pw.length < MIN_PW) redirect('/admin?e=short');
  if (pw !== pw2) redirect('/admin?e=mismatch');

  if (!(await setAdminPassword(pw, { onlyIfUnset: true }))) {
    // 先を越された。勝手にログインさせず、通常のログイン画面へ戻す
    redirect('/admin?e=taken');
  }
  await setCookie();
  redirect('/admin');
}

/** 設定後の変更。こちらは認証済みが前提 */
async function changePassword(formData: FormData) {
  'use server';
  await guard();
  const cur = String(formData.get('current') ?? '');
  const pw = String(formData.get('password') ?? '');
  const pw2 = String(formData.get('password2') ?? '');
  if (!(await checkPassword(cur))) redirect('/admin?e=curwrong');
  if (pw.length < MIN_PW) redirect('/admin?e=short');
  if (pw !== pw2) redirect('/admin?e=mismatch');
  await setAdminPassword(pw);
  redirect('/admin?e=pwok');
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
  const mode = String(formData.get('mode')) === 'disaster' ? 'disaster' : 'standby';
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

  const err = ERRORS[e ?? ''] ?? (e ? 'パスワードが違います' : null);

  /*
    初期設定。DBにも環境変数にもパスワードが無いときだけ出る。
    ★この画面は誰でも開ける。認証を要求できる材料がまだ無いため。
      デプロイ直後に運用者が真っ先に設定することが前提の導線で、
      放置すると先に見つけた人に管理画面を取られる。警告を明示する。
  */
  if (await needsAdminSetup()) {
    return (
      <>
        <h2>管理画面の初期設定</h2>
        {err && <p style={{ color: 'var(--bad)', fontWeight: 700 }}>{err}</p>}
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--bad)' }}>
            まだパスワードが設定されていません。
          </p>
          <p className="sub" style={{ marginBottom: 0 }}>
            設定が済むまで、この画面は誰でも開けます。管理画面は災害モードの切替と
            報告の非表示を行えるため、<strong>いますぐ設定してください。</strong>
          </p>
        </div>
        <form action={setupPassword}>
          <div className="field">
            <label htmlFor="pw">パスワード（{MIN_PW}文字以上）</label>
            <input id="pw" name="password" type="password" autoComplete="new-password" />
          </div>
          <div className="field">
            <label htmlFor="pw2">確認のためもう一度</label>
            <input id="pw2" name="password2" type="password" autoComplete="new-password" />
          </div>
          <button className="btn primary block" type="submit">設定する</button>
        </form>
        <p className="sub" style={{ marginTop: 12 }}>
          設定した内容はこのサーバのデータベースに保存されます（平文では保存しません）。
        </p>
      </>
    );
  }

  if (!(await isAdmin())) {
    return (
      <>
        <h2>管理</h2>
        {err && <p style={{ color: 'var(--bad)', fontWeight: 700 }}>{err}</p>}
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

  const [{ mode, notice }, reports, notices, dbPassword] = await Promise.all([
    getMode(), listOpenReports(), listPendingNotices(), hasAdminPassword(),
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
          <label>
            現在: <strong>{mode === 'disaster' ? '災害モード' : '平時（そなえ）'}</strong>
          </label>
          <div className="chips" style={{ marginTop: 8 }}>
            <label className="chip">
              <input type="radio" name="mode" value="standby" defaultChecked={mode === 'standby'} /> 平時（そなえ）
            </label>
            <label className="chip">
              <input type="radio" name="mode" value="disaster" defaultChecked={mode === 'disaster'} /> 災害
            </label>
          </div>
        </div>
        {/*
          災害種別は運営者が設定しない。
          豪雨でも、ある地区は洪水、別の地区は土砂災害、また別は内水氾濫。
          全体に1つの種別を設定しても、その人の状況に合っているとは限らない。
          利用者が自分で選ぶほうが正確で、運営者の負担も1つ減る。
          （画面側では選択を目立たせて、必ず選ばせる）
        */}
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

      {/*
        パスワードの変更。DB・環境変数のどちらで運用していても出す。

        当初はDBに設定がある場合だけ出していたが、それでは環境変数で動いている
        既存の本番から移行できない。DBへ入れる唯一の口が初期設定画面で、
        そちらは環境変数が無いときしか出ないため、鶏と卵になっていた。
        変更は常に「DBへ書く」動作なので、ここが移行の導線を兼ねる。
      */}
      <h2>パスワード</h2>
      {!dbPassword && (
        <div className="card">
          <p style={{ margin: 0 }}>
            現在は環境変数 <code>ADMIN_PASSWORD</code> で設定されています（サーバ上に平文で置かれます）。
          </p>
          <p className="sub" style={{ marginBottom: 0 }}>
            ここで変更すると、以後はこのサーバのデータベースに保存したハッシュが使われ、
            <strong>環境変数は参照されなくなります。</strong>
            変更後に <code>/etc/yui/production.env</code> の該当行を削除してください
            （残すと、どちらが現在のパスワードか分からなくなります）。
          </p>
        </div>
      )}
      <form action={changePassword} className="card">
        <div className="field">
          <label htmlFor="cur">現在のパスワード</label>
          <input id="cur" name="current" type="password" autoComplete="current-password" />
        </div>
        <div className="field">
          <label htmlFor="np">新しいパスワード（{MIN_PW}文字以上）</label>
          <input id="np" name="password" type="password" autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="np2">確認のためもう一度</label>
          <input id="np2" name="password2" type="password" autoComplete="new-password" />
        </div>
        <button className="btn-sm" type="submit">変更する</button>
      </form>
    </>
  );
}
