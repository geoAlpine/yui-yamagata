import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getMode } from '@/lib/queries';
import TabBar from '@/components/TabBar';
import { SITE_ENV, IS_REAL, PRODUCTION_URL } from '@/lib/env';

// Webフォントは読み込まない。回線が細い状況で真っ先に落ちるうえ、
// 日本語フォントは重い。システムフォントで十分（globals.css）。

export const metadata: Metadata = {
  // 本物と紛れないよう、タブのタイトルからしてステージングだと分かるようにする
  title: IS_REAL
    ? 'やまがた結（ゆい） — 山形の生活情報'
    : `【${SITE_ENV === 'staging' ? '確認用' : '開発中'}】やまがた結（ゆい）`,
  description:
    '開いてる店・通れる道の今を、見た人が報告し合う山形の生活情報サイト。営業中の店・ガソリン・給水・除雪状況などを住民同士で共有します。',
  // メタ側でも二重に止める（app/robots.ts と合わせて）
  robots: IS_REAL ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ノッチ／ホームインジケータの領域まで背景を伸ばし、safe-area で中身を避ける
  viewportFit: 'cover',
  // 端末がダークモードでも明るい画面を出す（ダークテーマは持たない）
  colorScheme: 'light',
  themeColor: '#fdfcf8',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { mode, notice } = await getMode();

  return (
    <html lang="ja">
      <body>
        {/*
          上部は細い固定バーだけにする。免責とモードは常時見せる必要があるが
          （公式を名乗らないことが設計原則）、タイトルや移動は本文と下部タブに回して
          スマホの縦方向を本文に使う。
        */}
        {/*
          ステージングを本物と取り違えると実害が出る。
          帯は最上部・全幅・スクロールしても消えない位置に置き、
          本番への逃げ道を必ず添える。
        */}
        {!IS_REAL && (
          <div className="envbar">
            <strong>
              {SITE_ENV === 'staging' ? '動作確認用のサイトです' : '開発中の画面です'}
            </strong>
            <span>ここに表示されている情報は本物ではありません。</span>
            <a href={PRODUCTION_URL}>本物のサイトはこちら</a>
          </div>
        )}

        <header className="topbar">
          <div className="topbar-row">
            <span className={`mode-pill ${mode}`}>
              {mode === 'disaster' ? '災害モード' : 'そなえ'}
            </span>
            <p className="disclaimer">
              住民の目撃情報です。公式情報ではありません。
            </p>
          </div>
          {notice ? <div className="notice-strip">{notice}</div> : null}
        </header>

        <main className="wrap">{children}</main>

        <TabBar />
      </body>
    </html>
  );
}
