'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCategory, attrsForStatus } from '@/lib/categories';
import { compressImage } from '@/lib/photo';

/**
 * 状況の報告。
 *
 * 被災地で長いフォームは埋められない。カードから来れば場所とカテゴリは既知なので、
 * 「状態を選ぶ → 送信」の2タップで完結させる。
 * 属性・メモは任意で、送信ボタンより下に畳んで置く（DESIGN.md 5.2）。
 */

const AGO_CHOICES = [
  { value: 0, label: '今' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 180, label: '3時間前' },
];

export default function ReportForm({
  spotId,
  spotName,
  category,
}: {
  spotId: string;
  spotName: string;
  category: string;
}) {
  const router = useRouter();
  const cat = getCategory(category);
  const [status, setStatus] = useState<string | null>(null);
  const [minutesAgo, setMinutesAgo] = useState(0);
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 写真。行列や貼り紙の1枚が持つ説得力は大きい。
  // 送る前に canvas で縮小・WebP化する。EXIF（GPS座標・端末情報）が
  // そこで落ちるので、投稿者の居場所が漏れない。
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const blob = await compressImage(f);
      if (!blob) { setError('この画像は使えませんでした'); return; }
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } finally {
      setPhotoBusy(false);
    }
  }

  if (!cat) return <p className="empty">不明なカテゴリです。</p>;

  const visibleAttrs = status ? attrsForStatus(category, status) : [];

  async function submit() {
    if (!status || sending) return;
    setSending(true);
    setError(null);
    try {
      // 写真を先に送る。ここで失敗しても報告自体は通すべきなので、
      // 写真だけ諦めて続ける（災害時に「写真のせいで投稿できない」が最悪）
      let photoPath: string | null = null;
      let photoBytes: number | null = null;
      if (photo) {
        const fd = new FormData();
        fd.append('photo', photo.blob, 'photo.webp');
        const pr = await fetch('/api/photos', {
          method: 'POST', body: fd, credentials: 'same-origin',
        });
        if (pr.ok) {
          const pd = await pr.json();
          photoPath = pd.path; photoBytes = pd.bytes;
        }
      }

      const res = await fetch('/api/observations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spotId,
          status,
          observedMinutesAgo: minutesAgo,
          attrs,
          note,
          photoPath,
          photoBytes,
        }),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '送信できませんでした');
        return;
      }
      router.push(`/spots/${spotId}`);
      router.refresh();
    } catch {
      setError('通信できませんでした。電波の状態を確認してください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 16 }}>{spotName}</h2>
      <p className="sub"><span className="cat-badge">{cat.short}</span></p>
      <p className="sub">今の状況を選んでください</p>

      <div className="status-choices">
        {cat.statuses.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`status-choice${status === s.id ? ' on' : ''}`}
            onClick={() => setStatus(s.id)}
            aria-pressed={status === s.id}
          >
            <span className={`dot ${s.severity}`} />
            {s.label}
          </button>
        ))}
      </div>

      {error && <p className="err">{error}</p>}

      {/* 送信は画面下に貼り付ける。片手で親指が届く位置に置く */}
      <div className="sticky-cta">
        <button
          className="btn primary block"
          onClick={submit}
          disabled={!status || sending}
        >
          {sending ? '送信中…' : '報告する'}
        </button>
      </div>

      {/* ここから下は任意。入力せずに送信できることを最優先にする */}
      <details className="optional">
        <summary>詳しく伝える（任意）</summary>

        <div className="field">
          <label>いつ見た情報ですか</label>
          <div className="chips">
            {AGO_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip${minutesAgo === c.value ? ' on' : ''}`}
                onClick={() => setMinutesAgo(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {visibleAttrs.map((a) => (
          <div className="field" key={a.id}>
            <label htmlFor={`attr-${a.id}`}>{a.label}</label>
            {a.type === 'select' ? (
              <select
                id={`attr-${a.id}`}
                value={attrs[a.id] ?? ''}
                onChange={(e) =>
                  setAttrs((p) => ({ ...p, [a.id]: e.target.value }))
                }
              >
                <option value="">（選ばない）</option>
                {a.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`attr-${a.id}`}
                type="text"
                value={attrs[a.id] ?? ''}
                onChange={(e) =>
                  setAttrs((p) => ({ ...p, [a.id]: e.target.value }))
                }
              />
            )}
          </div>
        ))}

        <div className="field">
          <label htmlFor="photo">写真（任意）</label>
          {photo ? (
            <div className="photo-pick">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="選んだ写真" />
              <button
                type="button"
                className="btn-sm"
                onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }}
              >
                取り消す
              </button>
            </div>
          ) : (
            <input
              id="photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={photoBusy}
              onChange={(e) => pickPhoto(e.target.files?.[0])}
            />
          )}
          {photoBusy && <p className="sub">読み込んでいます…</p>}
          {/*
            顔とナンバープレートは技術では消せない。
            投稿前に伝えるしかない。ここは目立たせる。
          */}
          <p className="spot-caution">
            <strong>人の顔や車のナンバーが写らないようにしてください。</strong>
            撮影場所などの情報（EXIF）は送信前に自動で消えますが、
            写っているものは消せません。誰でも見られる場所に公開されます。
          </p>
        </div>

        <div className="field">
          <label htmlFor="note">ひとこと（{note.length}/80）</label>
          <textarea
            id="note"
            rows={2}
            maxLength={80}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例: 20L制限。1時間待ち"
          />
        </div>
      </details>

      <p className="sub" style={{ marginTop: 20 }}>
        投稿は匿名です。個人が特定できる情報は書かないでください。
      </p>
    </>
  );
}
