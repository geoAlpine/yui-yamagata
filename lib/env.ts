/**
 * 実行環境の区別。
 *
 * 災害情報サイトのステージングは、ただの「開発用コピー」では済まない。
 * 被災した人が検索で見つけてテストデータを信じると、実害が出る。
 *   - 検索エンジンに載せない（noindex）
 *   - 開いた人が一目で本物でないと分かる帯を出す
 *   - 本番へのリンクを常に添える
 * この3つを環境変数ひとつで確実に切り替える。
 *
 * 既定は 'production'。**設定し忘れたときに本番として振る舞う**のではなく、
 * 逆にしたい誘惑があるが、それだと本番で誤ってステージング表示が出る事故のほうが
 * 起きやすい。ステージング側で明示的に指定させる。
 */
export type SiteEnv = 'production' | 'staging' | 'development';

export const SITE_ENV: SiteEnv =
  process.env.SITE_ENV === 'staging'
    ? 'staging'
    : process.env.NODE_ENV !== 'production'
      ? 'development'
      : 'production';

export const IS_REAL = SITE_ENV === 'production';

/** 本番のURL。ステージングから誘導するために使う */
export const PRODUCTION_URL =
  process.env.PRODUCTION_URL ?? 'https://yui-yamagata.com';
