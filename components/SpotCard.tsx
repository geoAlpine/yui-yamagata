'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getCategory, getStatus, attrsForStatus, hazardLabel } from '@/lib/categories';
import { evaluateFreshness, formatAge } from '@/lib/freshness';
import type { SpotRow } from '@/lib/queries';

function formatDistance(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

export default function SpotCard({
  spot,
  serverNow,
  isFavorite,
  onToggleFavorite,
}: {
  spot: SpotRow;
  serverNow: number;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
}) {
  // 鮮度は時間とともに変わる。初回描画はサーバ時刻で固定してハイドレーション不一致を防ぎ、
  // マウント後はクライアント時刻で1分ごとに更新する。
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    // 初回はサーバ時刻のまま描画してハイドレーション不一致を避け、
    // 描画が済んでからクライアントの時計に切り替える（同期 setState はしない）。
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(first); clearInterval(tick); };
  }, []);

  const [voted, setVoted] = useState<null | 'yes' | 'no'>(null);
  const [sending, setSending] = useState(false);

  const cat = getCategory(spot.category);
  const hasObs = spot.obs_id != null && spot.observed_at != null;
  const fresh = hasObs
    ? evaluateFreshness(spot.category, spot.observed_at!, new Date(now))
    : null;

  const status = hasObs ? getStatus(spot.category, spot.status!) : undefined;
  // TTLを超えたら状態を伏せて「不明」に戻す。古い情報を新鮮なふりで出さない。
  const showStatus = fresh?.showStatus && status;
  const conflicted = spot.disagrees > spot.agrees && spot.disagrees > 0;

  async function vote(agrees: boolean) {
    if (!spot.obs_id || sending) return;
    setSending(true);
    try {
      await fetch('/api/confirmations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 投稿者IDは送らない。サーバが署名付き cookie で識別する
        body: JSON.stringify({ observationId: spot.obs_id, agrees }),
        credentials: 'same-origin',
      });
      setVoted(agrees ? 'yes' : 'no');
    } finally {
      setSending(false);
    }
  }

  const dist = formatDistance(spot.distance_m);

  return (
    <article className={`card${fresh?.level === 'stale' ? ' is-stale' : ''}`}>
      <div className="card-head">
        <Link className="card-name" href={`/spots/${spot.id}`}>
          {spot.name}
          {spot.is_priority && <span className="priority">自家発電</span>}
        </Link>
        {dist && <span className="dist">{dist}</span>}
        {onToggleFavorite && (
          <button
            className={`fav${isFavorite ? ' on' : ''}`}
            onClick={() => onToggleFavorite(spot.id)}
            aria-label={isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
            aria-pressed={!!isFavorite}
            title="お気に入り（この端末にのみ保存）"
          >
            {isFavorite ? '★' : '☆'}
          </button>
        )}
      </div>

      {/*
        住所を名前の直下に出す。
        OSM由来のスポットは名前がブランド名だけのことが多く、
        「エネオス」が一覧に4つ並んで区別できなかった。
        町名まで出せば「さっき見たスタンド」を探せる。
      */}
      {spot.address && <div className="addr">{spot.address}</div>}

      {/* 種類は絵文字ではなく短い日本語のバッジで示す */}
      <div className="statusline">
        {cat && <span className="cat-badge">{cat.short}</span>}
        {showStatus ? (
          <span className={`status ${status!.severity}`}>{status!.label}</span>
        ) : (
          <span className="status unknown">
            {hasObs ? '状況不明（情報が古い）' : 'まだ情報がありません'}
          </span>
        )}
      </div>

      {showStatus && spot.attrs && (
        <div className="attrs">
          {attrsForStatus(spot.category, spot.status!).map((a) => {
            const v = spot.attrs?.[a.id];
            if (!v) return null;
            const label =
              a.options?.find((o) => o.value === v)?.label ?? `${v}${a.unit ?? ''}`;
            return <span key={a.id}>{label}</span>;
          })}
        </div>
      )}

      {showStatus && spot.obs_note && <div className="note">{spot.obs_note}</div>}

      {/*
        指定緊急避難場所は災害種別ごとに指定されている。
        地震向けの場所が洪水で使えるとは限らない。
        「避難場所だから安全」という思い込みは命に関わるので必ず出す。
      */}
      {spot.hazards && spot.hazards.length > 0 && (
        <div className="hazards">
          <span className="hazards-label">対応する災害</span>
          {spot.hazards.map((h) => (
            <span key={h} className="hazard">{hazardLabel(h)}</span>
          ))}
        </div>
      )}
      {spot.category === 'evacuation' && spot.hazards?.length === 0 && (
        <p className="spot-caution">
          対応する災害種別が登録されていません。市町村にご確認ください。
        </p>
      )}

      {/*
        井戸水は飲用可否が不明なことがあり、健康被害に直結する。
        イマココナビは「給水場・井戸水」を1カテゴリにまとめていたが、
        ここは区別したうえで注意を明示する。
      */}
      {showStatus && spot.attrs?.waterType === 'well' && (
        <p className="spot-caution">
          井戸水です。飲用できるかは自治体の案内を確認してください。煮沸しても
          安全とは限りません。
        </p>
      )}

      {/*
        鮮度は店名の次に目立たせる。
        「いつの情報か」は状態そのものより判断材料になる場面が多い。
      */}
      {hasObs && fresh && (
        <div className="age">
          <span className={fresh.level === 'fresh' ? 'strong' : 'age-warn'}>
            {formatAge(fresh.ageMinutes)}に確認
          </span>
          {spot.agrees > 0 && <span>{spot.agrees}人が同意</span>}
          {conflicted && <span className="conflict">⚠ 情報が食い違っています</span>}
          {fresh.level === 'aging' && <span>情報が古い可能性</span>}
        </div>
      )}

      {/* 再確認は1タップで完結させる。ここが情報の生存率を決める */}
      {hasObs && fresh && fresh.level !== 'stale' && (
        <div className={`confirm${fresh.emphasizeConfirm ? ' emphasize' : ''}`}>
          {voted ? (
            <span className="confirm-done">
              {voted === 'yes' ? 'ありがとうございます' : '報告ありがとうございます'}
            </span>
          ) : (
            <>
              <span className="q">まだこの状況ですか？</span>
              <button
                className="btn-sm yes"
                onClick={() => vote(true)}
                disabled={sending}
              >
                はい
              </button>
              <Link className="btn-sm no" href={`/report/${spot.id}`}>
                違う
              </Link>
            </>
          )}
        </div>
      )}

      {!hasObs && (
        <div className="confirm">
          <span className="q">今の状況を知っていますか？</span>
          <Link className="btn-sm" href={`/report/${spot.id}`}>
            報告する
          </Link>
        </div>
      )}
    </article>
  );
}
