import type { NextConfig } from "next";

/**
 * CDN（Cloudflare）にHTMLをキャッシュさせるためのヘッダ。
 *
 * ── なぜ要るか ──
 * 一覧も詳細も searchParams（?cat= ?muni= ?hz= ?q=）で絞り込む作りなので、
 * Next.js は動的レンダリングと判定し `private, no-cache, no-store` を返す。
 * JSが無くても絞り込めるようにするための設計で、これ自体は正しい。
 *
 * ただしその結果、CDNが1件もキャッシュせず、全リクエストがVPSに届く。
 * 熊本地震のイマココナビは7万人/日を捌いた。同規模が来たとき、
 * 商用サイトが同居するこのVPSでは持たない。
 *
 * ── なぜCDN側の設定で上書きしないのか ──
 * Cloudflare の Cache Rules でも Edge TTL を強制できるが、
 * 無料プランの最小値が2時間で、災害情報には長すぎる。
 * 「開いている」と表示されたまま2時間は実害になる。
 *
 * そもそも「どのページをどれだけキャッシュしてよいか」を知っているのは
 * アプリであってCDNの設定画面ではない。ここで宣言しておけば、
 * Cloudflareを外しても、別のCDNに替えても同じように振る舞う。
 *
 * ── 30秒の根拠 ──
 * カテゴリごとのTTLは2〜24時間（lib/categories.ts）。それに対して30秒の
 * 遅れは無視できる。一方でVPSへの到達は 1URLあたり30秒に1回まで落ちる。
 *
 * `revalidatePath()` はNext.js側のキャッシュを消すだけで、CDNには届かない。
 * 新しい報告が一覧に出るまで最大30秒かかる。詳細ページを開けば即座に見える。
 *
 * ── 載せてはいけないもの ──
 * /mine  投稿者ごとの一覧。キャッシュすると他人の投稿が別人に配られる
 * /admin 管理セッションごとに内容が変わる
 * /api/  投稿の受付と状態取得。常に最新でなければならない
 *
 * ここには列挙しない。Cloudflare 側でも Bypass するルールを置いて二重に守る。
 * 片方が外れても事故にならないようにする。
 */
const CDN_CACHE = "public, max-age=0, s-maxage=30, stale-while-revalidate=120";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // 一覧。カテゴリ・市町村・災害種別の絞り込みはクエリに載るので、
      // CDN側はクエリを含めてキャッシュキーを作る必要がある（既定でそうなる）
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: CDN_CACHE }],
      },
      {
        source: "/notices",
        headers: [{ key: "Cache-Control", value: CDN_CACHE }],
      },
      // 個別スポット。災害時にリンクが共有されて集中しやすい
      {
        source: "/spots/:id",
        headers: [{ key: "Cache-Control", value: CDN_CACHE }],
      },
    ];
  },
};

export default nextConfig;
