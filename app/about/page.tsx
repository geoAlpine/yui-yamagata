import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, SITE_NAME } from '@/lib/seo';
import { PHOTO } from '@/lib/photo';

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: `このサイトについて | ${SITE_NAME}`,
  description:
    '運営者、情報の扱い方、免責事項。住民の目撃情報を共有する仕組みで、公式発表ではありません。',
});

/**
 * 運営者と方針の開示。
 *
 * 災害時に人の行動を左右する情報を扱う以上、「誰が運営しているか」と
 * 「この情報がどう作られているか」を隠したまま使わせるべきではない。
 *
 * とくにモデレーションを利用者に委ねる設計を採ったので、そのことは
 * 曖昧にせず書く。「運営が確認しています」と誤解されたまま使われるのが
 * いちばん危ない。
 */
export default function AboutPage() {
  return (
    <>
      <p style={{ marginTop: 14 }}>
        <Link href="/">← 一覧にもどる</Link>
      </p>

      <h1 style={{ fontSize: 21, margin: '10px 0 16px' }}>このサイトについて</h1>

      <div className="card">
        <p>
          災害のときに「どこで水がもらえるか」「どのスタンドが開いているか」を、
          住民どうしで共有する仕組みです。山形県内を対象にしています。
        </p>
        <p style={{ marginTop: 10 }}>
          2026年の熊本の地震で、住民が状況を出し合う場が大きく役に立ちました。
          同じものを山形にも用意しておきたい、というのが作った理由です。
        </p>
      </div>

      {/*
        いちばん誤解されると危ないことを最初に置く。
        「誰かが確認している」と思われたまま使われるのが最悪の形。
      */}
      <h2>ここに出ている情報は、誰も確認していません</h2>
      <div className="card">
        <p>
          投稿はすべて、その場にいた人がそのまま書き込んだものです。
          <strong>運営者が事前に確認することはありません。</strong>
          間違いも、古い情報も、いたずらも混ざりえます。
        </p>
        <p style={{ marginTop: 10 }}>
          事前に確認する仕組みにしなかったのは、災害時にそれが間に合わないからです。
          確認を待つあいだに情報は古くなり、結局は誰の役にも立ちません。
          速さを取り、そのぶん「確かさ」は利用者が判断するものとしています。
        </p>
        <p style={{ marginTop: 10 }}>
          そのため、次の仕組みを置いています。
        </p>
        <ul className="about-list">
          <li>
            <strong>情報は時間で古くなる。</strong>
            種類ごとに決めた時間を過ぎた投稿は、状態を伏せて「不明」に戻します。
            古い情報を新しいもののように見せません。
          </li>
          <li>
            <strong>見た人が確かめる。</strong>
            「まだこの状況ですか？」に答えていただくことで、情報が生き続けます。
            食い違いが出た場合はその旨を表示します。
          </li>
          <li>
            <strong>おかしいものは通報できる。</strong>
            各ページの「この情報を通報する」からお知らせください。
            押した瞬間には消えません。即座に消せる仕組みは、
            正しい情報を消すための手段にもなってしまうためです。
          </li>
        </ul>
        <p className="spot-caution" style={{ marginTop: 12 }}>
          <strong>避難の判断は、必ず市町村の避難情報に従ってください。</strong>
          このサイトの情報だけで行動を決めないでください。
        </p>
      </div>

      <h2>運営者</h2>
      <div className="card">
        <dl className="about-dl">
          <dt>運営</dt>
          <dd>geoAlpine合同会社</dd>
          <dt>所在</dt>
          <dd>山形県</dd>
          <dt>連絡先</dt>
          <dd>
            <a href="https://github.com/geoAlpine/yui-yamagata/issues">
              GitHub の Issues
            </a>
            （不具合・ご要望）
          </dd>
        </dl>
        <p style={{ marginTop: 10 }}>
          自治体や公的機関が運営しているものではありません。
          一民間企業が、地元のために自主的に運用しています。
        </p>
      </div>

      <h2>写真について</h2>
      <div className="card">
        <p>
          投稿された写真は<strong>{PHOTO.retentionDays}日で自動的に消えます。</strong>
          撮影場所などの記録（EXIF）は、送信される前に端末側で取り除いています。
        </p>
        <p style={{ marginTop: 10 }}>
          ただし<strong>写り込んだものは消せません。</strong>
          人の顔や車のナンバーが入らないよう、撮影時にご注意ください。
          不適切な写真を見つけた場合は通報してください。
        </p>
      </div>

      <h2>情報の出どころ</h2>
      <div className="card">
        <dl className="about-dl">
          <dt>避難場所・避難所</dt>
          <dd>
            国土地理院「指定緊急避難場所・指定避難所データ」。
            災害対策基本法に基づき市町村長が指定したものです。
            <strong>最新でない場合や、未掲載の場合があります。</strong>
            最新かつ詳細な情報は各市町村にご確認ください。
          </dd>
          <dt>店舗・施設の位置</dt>
          <dd>
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
            {' '}© OpenStreetMap contributors（ODbL 1.0）
          </dd>
          <dt>住所（町名）</dt>
          <dd>国土地理院の逆ジオコーディング</dd>
          <dt>今の状況</dt>
          <dd>住民の投稿。公的な情報ではありません</dd>
        </dl>
        <p style={{ marginTop: 10 }}>
          <strong>「指定されている」ことと「今開いている」ことは別です。</strong>
          公式が言えるのは前者だけで、後者は発表までに時間がかかります。
          その差を住民の目撃情報で埋めるのが、このサイトの役割です。
        </p>
      </div>

      {/*
        他県からの利用について。
        この種のものは、災害が起きてから作り始めても間に合わない。
        平時に手を動かせる状態にしておくことに意味がある。
      */}
      <h2>他の都道府県で使いたい方へ</h2>
      <div className="card">
        <p>
          このサイトの仕組みは公開しています（Apache License 2.0）。
          自由に複製・改変してお使いいただけます。
        </p>
        <p style={{ marginTop: 10 }}>
          元にしているデータ（国土地理院・OpenStreetMap）は全国どこでも同じ形式で
          手に入るので、<strong>都道府県コードを差し替えれば他県でも動きます。</strong>
          手順は README にまとめてあります。
        </p>
        <p style={{ marginTop: 10 }}>
          <a href="https://github.com/geoAlpine/yui-yamagata">
            github.com/geoAlpine/yui-yamagata
          </a>
        </p>
        <p style={{ marginTop: 10 }}>
          災害が起きてから作り始めても間に合いません。
          平時に動かせる状態にしておくことに意味があります。
          お困りの点は Issues にお寄せください。
        </p>
      </div>

      <h2>免責</h2>
      <div className="card">
        <p>
          掲載されている情報の正確性・最新性について、運営者は保証しません。
          このサイトの利用によって生じた損害について、運営者は責任を負いません。
        </p>
        <p style={{ marginTop: 10 }}>
          災害時にはサーバーや通信そのものが使えなくなることがあります。
          このサイトが使えることを前提にした避難計画は立てないでください。
        </p>
      </div>

      <p className="sub" style={{ marginTop: 24, marginBottom: 8 }}>
        <Link href="/">一覧にもどる</Link>
      </p>
    </>
  );
}
