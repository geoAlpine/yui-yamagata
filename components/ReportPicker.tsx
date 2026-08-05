'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getCategory } from '@/lib/categories';
import { readHome } from '@/lib/home';
import type { SpotRow } from '@/lib/queries';

function dist(m: number | null) {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

/**
 * 報告する場所を選ぶ一覧。
 *
 * 一覧のカードと違い、状態や鮮度は出さない。ここでの目的は
 * 「どの場所か」を選ぶことだけなので、余計なものを出すと迷う。
 */
export default function ReportPicker({
  initialSpots,
  categories,
}: {
  initialSpots: SpotRow[];
  categories: string[];
  serverNow: number;
}) {
  const key = categories.join(',');
  const [fetched, setFetched] = useState<{ key: string; spots: SpotRow[] } | null>(null);
  const spots = fetched?.key === key ? fetched.spots : initialSpots;
  const [located, setLocated] = useState(false);

  const sortNear = useCallback(
    (lat: number, lng: number) => {
      const p = new URLSearchParams({ lat: String(lat), lng: String(lng), categories: key });
      fetch(`/api/spots?${p}`)
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.spots)) setFetched({ key, spots: d.spots });
          setLocated(true);
        })
        .catch(() => {});
    },
    [key]
  );

  // 自宅が登録してあればそれを、無ければ現在地を使う。
  // 報告するのは自分がいる場所なので、現在地のほうが自然だが、
  // 「自宅の様子を聞いて代わりに報告する」場合もある。
  useEffect(() => {
    const t = setTimeout(() => {
      const home = readHome();
      if (!navigator.geolocation) {
        if (home) sortNear(home.lat, home.lng);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => sortNear(p.coords.latitude, p.coords.longitude),
        () => { if (home) sortNear(home.lat, home.lng); },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 }
      );
    }, 0);
    return () => clearTimeout(t);
  }, [sortNear]);

  if (spots.length === 0) {
    return (
      <p className="empty">
        該当する場所がありません。
        <br />
        <span className="sub">種類を変えるか、下から新しく追加してください。</span>
      </p>
    );
  }

  return (
    <>
      <p className="sub" style={{ margin: '8px 0' }}>
        {located ? '近い順に表示しています。' : '場所を選ぶと報告画面に進みます。'}
      </p>
      <ul className="picker">
        {spots.map((s) => {
          const cat = getCategory(s.category);
          const d = dist(s.distance_m);
          return (
            <li key={s.id}>
              <Link href={`/report/${s.id}`}>
                <span className="pick-name">{s.name}</span>
                {s.address && <span className="pick-addr">{s.address}</span>}
                <span className="pick-meta">
                  {cat && <span className="cat-badge">{cat.short}</span>}
                  {d && <span className="dist">{d}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
