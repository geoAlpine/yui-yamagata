'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

/**
 * 下部タブバー。
 *
 * スマホ縦持ちで片手操作する前提なので、移動は親指の届く画面下に置く。
 *
 * アイコンは絵文字ではなくインラインSVGを使う。絵文字は端末ごとに
 * 描画が変わり、サイズも色も揃わない。線画なら currentColor に従うので
 * 選択中の色替えがそのまま効き、屋外でも輪郭が読める。
 */

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width="23" height="23" aria-hidden {...S}>
      {children}
    </svg>
  );
}

const TABS = [
  {
    href: '/',
    label: '生活情報',
    icon: (
      <Icon>
        <path d="M4 11.2 12 4l8 7.2V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
      </Icon>
    ),
    match: (p: string) =>
      p === '/' || (p.startsWith('/spots') && p !== '/spots/new') || p.startsWith('/report'),
  },
  {
    href: '/notices',
    label: 'お知らせ',
    icon: (
      <Icon>
        <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 3.8 1.3 5.2 1.8 5.8H4.7c.5-.6 1.8-2 1.8-5.8Z" />
        <path d="M10 18.6a2 2 0 0 0 4 0" />
      </Icon>
    ),
    match: (p: string) => p.startsWith('/notices'),
  },
  {
    href: '/spots/new',
    label: '場所を追加',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.3" />
        <path d="M12 8.4v7.2M8.4 12h7.2" />
      </Icon>
    ),
    match: (p: string) => p === '/spots/new',
  },
];

export default function TabBar() {
  const pathname = usePathname() ?? '/';
  if (pathname.startsWith('/admin')) return null;

  return (
    <nav className="tabbar" aria-label="メニュー">
      {TABS.map((t) => {
        const on = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={on ? 'on' : ''}
            aria-current={on ? 'page' : undefined}
          >
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
