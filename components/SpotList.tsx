'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SpotCard from './SpotCard';
import { readFavorites, toggleFavorite } from '@/lib/favorites';
import { readHome, saveHome, clearHome, type HomeLocation } from '@/lib/home';
import { getCategory } from '@/lib/categories';
import type { SpotRow } from '@/lib/queries';

/**
 * 一覧。
 *
 * サーバが「最近更新された順」で描画したHTMLをそのまま受け取り、
 * 位置情報が取れたらクライアントで「近い順」に取り直す。
 *
 * これにより JS が落ちても・位置情報を拒否しても、一覧は最初から読める。
 * 地図を既定にしないのは、災害時に地図タイルが真っ先に開けなくなるため（DESIGN.md 5.1）。
 */
export default function SpotList({
  initialSpots,
  categories,
  serverNow,
  emptyCategory,
}: {
  initialSpots: SpotRow[];
  categories: string[];
  serverNow: number;
  /** 単一カテゴリで絞り込んでいる場合のID。空のときの説明を出し分ける */
  emptyCategory?: string | null;
}) {
  const [locState, setLocState] = useState<
    'idle' | 'asking' | 'ok' | 'denied' | 'unavailable'
  >('idle');

  // 自宅（気になる場所）。発災時に自宅にいるとは限らないので、
  // 現在地とは別に持てるようにする。職場から自宅周辺を見る、が現実的な使い方。
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [basis, setBasis] = useState<'current' | 'home'>('current');
  useEffect(() => {
    const t = setTimeout(() => {
      const h = readHome();
      setHome(h);
      // 自宅が登録してあれば、そちらを既定にする。
      // わざわざ登録した人は、そこを見たいはずなので。
      if (h) setBasis('home');
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // 位置情報で取り直した結果。どの絞り込みに対する結果かを一緒に持つ。
  // props を state に写す effect を書くと、カテゴリを切り替えたときに
  // 古い結果が一瞬残る。どの条件の結果かを見て派生させれば effect は要らない。
  const filterKey = categories.join(',');
  const [fetched, setFetched] = useState<{ key: string; spots: SpotRow[] } | null>(null);
  const spots = fetched?.key === filterKey ? fetched.spots : initialSpots;

  // お気に入りは端末内にのみ持つ。サーバは知らないので描画後に読む。
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const t = setTimeout(() => setFavorites(readFavorites()), 0);
    return () => clearTimeout(t);
  }, []);

  // お気に入りを先頭に。距離順・新着順という本来の並びは崩さず、前に寄せるだけ。
  const ordered = useMemo(() => {
    if (favorites.size === 0) return spots;
    const fav: SpotRow[] = [];
    const rest: SpotRow[] = [];
    for (const s of spots) (favorites.has(s.id) ? fav : rest).push(s);
    return [...fav, ...rest];
  }, [spots, favorites]);

  const sortByDistance = useCallback(
    (lat: number, lng: number) => {
      const q = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        categories: categories.join(','),
      });
      fetch(`/api/spots?${q}`)
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.spots)) {
            setFetched({ key: categories.join(','), spots: d.spots });
          }
          setLocState('ok');
        })
        .catch(() => setLocState('unavailable'));
    },
    [categories]
  );

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) return setLocState('unavailable');
    setLocState('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => sortByDistance(p.coords.latitude, p.coords.longitude),
      () => setLocState('denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 }
    );
  }, [sortByDistance]);

  // 権限が既に許可済みなら黙って近い順にする。毎回タップさせない。
  useEffect(() => {
    if (basis !== 'current') return;
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (s.state === 'granted') requestLocation();
      })
      .catch(() => {});
  }, [requestLocation, basis]);

  // 自宅を基準にする
  useEffect(() => {
    if (basis === 'home' && home) sortByDistance(home.lat, home.lng);
  }, [basis, home, sortByDistance]);

  /** 現在地を自宅として登録する。地図が無いので、家にいるときに押してもらう */
  function registerHome() {
    if (!('geolocation' in navigator)) return setLocState('unavailable');
    setLocState('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const h = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          label: 'この端末で登録した場所',
        };
        saveHome(h);
        setHome(h);
        setBasis('home');
        setLocState('idle');
      },
      () => setLocState('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  return (
    <>
      <div className="locbar">
        {home ? (
          <>
            <span>
              {basis === 'home' ? '登録した場所から近い順' : '現在地から近い順'}
            </span>
            <button onClick={() => setBasis(basis === 'home' ? 'current' : 'home')}>
              {basis === 'home' ? '現在地に切り替え' : '登録した場所に切り替え'}
            </button>
            <button
              onClick={() => { clearHome(); setHome(null); setBasis('current'); }}
            >
              登録を消す
            </button>
          </>
        ) : locState === 'ok' ? (
          <>
            <span>現在地から近い順に表示中</span>
            {/*
              発災時に自宅にいるとは限らない。職場から自宅周辺を見たい、
              家族のいる地域を確認したい、という使い方のほうが多い。
              地図が無いので「家にいるときに押してもらう」形にする。
            */}
            <button onClick={registerHome}>ここを自宅として登録</button>
          </>
        ) : (
          <>
            <span>
              {locState === 'denied'
                ? '位置情報が使えないため、新しい順で表示しています'
                : locState === 'unavailable'
                  ? 'この端末では位置情報が使えません'
                  : '新しい順で表示しています。近い順にすると探しやすくなります'}
            </span>
            {locState !== 'unavailable' && (
              <button onClick={requestLocation} disabled={locState === 'asking'}>
                {locState === 'asking' ? '取得中…' : '近い順にする'}
              </button>
            )}
          </>
        )}
      </div>

      {home && basis === 'home' && (
        <p className="sub" style={{ marginTop: -4, marginBottom: 10 }}>
          自宅として登録した場所を基準にしています。この端末にのみ保存され、
          サーバには送られません。
        </p>
      )}

      {ordered.length === 0 ? (
        <EmptyState categoryId={emptyCategory} />
      ) : (
        ordered.map((s) => (
          <SpotCard
            key={s.id}
            spot={s}
            serverNow={serverNow}
            isFavorite={favorites.has(s.id)}
            onToggleFavorite={(id) => setFavorites(toggleFavorite(id))}
          />
        ))
      )}

      {favorites.size > 0 && (
        <p className="sub" style={{ marginTop: 12 }}>
          ★のついた場所を先頭に表示しています。お気に入りはこの端末にのみ保存され、
          他の端末には引き継がれません。
        </p>
      )}
    </>
  );
}

/**
 * 0件のときの説明。
 *
 * 「空」には2種類あり、同じ文言で済ませると利用者に嘘をつく。
 *   - 給水所や物資配布は、平時には存在しない。発災時に自治体が設置して初めて生まれる。
 *     ここで「登録してください」と促すのは的外れ。
 *   - 除雪や路面は、場所が実在するのに誰も登録していないだけ。
 *     こちらは最初の1件を促すべきで、「空で正常」と言ってはいけない。
 */
function EmptyState({ categoryId }: { categoryId?: string | null }) {
  const cat = categoryId ? getCategory(categoryId) : null;

  if (cat?.emptyReason === 'disasterOnly') {
    return (
      <p className="empty">
        {cat.label}の情報は、災害が起きたときに集まります。
        <br />
        <span className="sub">
          給水所や物資の配布場所は、自治体が設置してから登録されます。
          <br />
          いま設置されているのを見かけたら、下の「場所を追加」から登録できます。
        </span>
      </p>
    );
  }

  return (
    <p className="empty">
      {cat ? `${cat.label}は` : 'この種類の場所は'}まだ登録がありません。
      <br />
      <span className="sub">
        あなたの報告が最初の1件になります。
        <br />
        下の「場所を追加」から登録してください。
      </span>
    </p>
  );
}
