'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { categoriesForMode, type Mode } from '@/lib/categories';

const MUNICIPALITIES = [
  '山形市', '米沢市', '鶴岡市', '酒田市', '新庄市', '寒河江市', '上山市',
  '村山市', '長井市', '天童市', '東根市', '尾花沢市', '南陽市',
];

interface Nearby {
  id: string;
  name: string;
  distance_m: number;
}

/**
 * 場所の追加。
 *
 * 座標は現在地から取る。地図を持たないので、住所から座標を出すには
 * ジオコーディングAPIが要るが、災害時に外部APIへ依存するのは避ける。
 * 「その場に立っている人が登録する」前提にすれば、位置情報だけで足りる。
 *
 * 重複登録は設計上の急所。同じ場所が二重に立つと観測が分散し、
 * 「場所に観測が積み重なる」という利点がそのまま失われる。
 * そのため送信前に近隣を照会し、候補があれば必ず見せる。
 */
export default function SpotForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const cats = categoriesForMode(mode);

  const [category, setCategory] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [note, setNote] = useState('');

  const [coords, setCoords] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [locState, setLocState] = useState<'idle' | 'asking' | 'denied' | 'error'>('idle');

  const [nearby, setNearby] = useState<Nearby[] | null>(null);
  const [confirmedNew, setConfirmedNew] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getLocation() {
    if (!('geolocation' in navigator)) return setLocState('error');
    setLocState('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: Math.round(p.coords.accuracy),
        });
        setLocState('idle');
        setNearby(null);
        setConfirmedNew(false);
      },
      () => setLocState('denied'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  const ready = category && name.trim() && coords;

  async function submit() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/spots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name, category, note,
          address: address || null,
          municipality: municipality || null,
          lat: coords!.lat,
          lng: coords!.lng,
          // 近隣候補を見せたうえで「これは別の場所」と確認済みか
          force: confirmedNew,
        }),
      });
      const data = await res.json();

      // 近くに同じカテゴリの場所がある。まず既存を見せる
      if (res.status === 409 && Array.isArray(data.nearby)) {
        setNearby(data.nearby);
        return;
      }
      if (!res.ok) return setError(data.error ?? '登録できませんでした');

      router.push(`/report/${data.id}`);
      router.refresh();
    } catch {
      setError('通信できませんでした。電波の状態を確認してください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 16 }}>場所を追加する</h2>
      <p className="sub">
        いま自分がいる場所を登録します。位置情報から座標を取るため、
        <strong>その場所にいるときに</strong>登録してください。
      </p>

      <div className="field" style={{ marginTop: 16 }}>
        <label>1. 位置（必須）</label>
        {coords ? (
          <div className="coords-ok">
            位置を取得しました（誤差 約{coords.acc}m）
            <button className="btn-sm" onClick={getLocation} style={{ marginLeft: 8 }}>
              取り直す
            </button>
            {coords.acc > 100 && (
              <p className="spot-caution">
                誤差が大きいです。屋外に出るか、少し待ってから取り直すと精度が上がります。
              </p>
            )}
          </div>
        ) : (
          <>
            <button className="btn block" onClick={getLocation} disabled={locState === 'asking'}>
              {locState === 'asking' ? '取得中…' : '現在地を取得'}
            </button>
            {locState === 'denied' && (
              <p className="spot-caution">
                位置情報が使えません。端末の設定でこのサイトに位置情報を許可してください。
              </p>
            )}
            {locState === 'error' && (
              <p className="spot-caution">この端末では位置情報が使えません。</p>
            )}
          </>
        )}
      </div>

      <div className="field">
        <label>2. 種類（必須）</label>
        <div className="chips">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${category === c.id ? ' on' : ''}`}
              onClick={() => { setCategory(c.id); setNearby(null); setConfirmedNew(false); }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="name">3. 名前（必須）</label>
        <input id="name" type="text" value={name} maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: ヤマザワ 南館店" />
      </div>

      {/* 重複候補。送信をブロックしてでも見せる */}
      {nearby && nearby.length > 0 && (
        <div className="caution">
          <strong>近くに同じ種類の場所があります</strong>
          <p>すでに登録されている場所なら、そちらに報告してください。</p>
          {nearby.map((n) => (
            <p key={n.id}>
              <a href={`/report/${n.id}`}>
                {n.name}（約{Math.round(n.distance_m)}m先）に報告する →
              </a>
            </p>
          ))}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input type="checkbox" checked={confirmedNew}
              onChange={(e) => setConfirmedNew(e.target.checked)} />
            <span>どれとも違う、別の場所です</span>
          </label>
        </div>
      )}

      <details className="optional">
        <summary>住所などを足す（任意）</summary>
        <div className="field">
          <label htmlFor="addr">住所</label>
          <input id="addr" type="text" value={address} maxLength={80}
            onChange={(e) => setAddress(e.target.value)} placeholder="例: 山形市南館5丁目" />
        </div>
        <div className="field">
          <label htmlFor="muni">市町村</label>
          <select id="muni" value={municipality} onChange={(e) => setMunicipality(e.target.value)}>
            <option value="">（指定しない）</option>
            {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="snote">補足</label>
          <input id="snote" type="text" value={note} maxLength={60}
            onChange={(e) => setNote(e.target.value)} placeholder="例: 24時間営業 / 自家発電あり" />
        </div>
      </details>

      {error && <p className="err">{error}</p>}

      <div className="sticky-cta">
        <button className="btn primary block" onClick={submit}
          disabled={!ready || sending || (!!nearby?.length && !confirmedNew)}>
          {sending ? '登録中…' : '登録して状況を報告する'}
        </button>
      </div>
      <p className="sub" style={{ marginTop: 12 }}>
        登録後、そのまま今の状況を報告する画面に進みます。
      </p>
    </>
  );
}
