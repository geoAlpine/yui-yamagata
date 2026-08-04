'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NOTICE_KINDS, getNoticeKind } from '@/lib/notices';

const MUNICIPALITIES = [
  '山形市', '米沢市', '鶴岡市', '酒田市', '新庄市', '寒河江市', '上山市',
  '村山市', '長井市', '天童市', '東根市', '尾花沢市', '南陽市',
];

/**
 * お知らせの投稿。
 *
 * observations（状況の報告）とは意図的に体験を変えている。
 * あちらは2タップで終わらせるが、こちらは記名・連絡先を必須にして、
 * あえて摩擦を残す。「ここに物資を送ってください」は詐欺・転売・
 * 善意の殺到の入口になるため、匿名で素早く出せてはいけない。
 */
export default function NoticeForm() {
  const router = useRouter();
  const [kind, setKind] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [organization, setOrganization] = useState('');
  const [contact, setContact] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [days, setDays] = useState(7);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = kind ? getNoticeKind(kind) : null;
  const ready =
    kind && title.trim() && body.trim() && organization.trim() && contact.trim();

  async function submit() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind, title, body, organization, contact,
          municipality: municipality || null,
          days,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? '送信できませんでした');
      router.push('/notices');
      router.refresh();
    } catch {
      setError('通信できませんでした。電波の状態を確認してください。');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 16 }}>お知らせを出す</h2>
      <p className="sub">種類を選んでください</p>

      <div className="status-choices">
        {NOTICE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`status-choice${kind === k.id ? ' on' : ''}`}
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* 注意書きは選択後すぐ、入力前に出す。読ませてから書かせる */}
      {def && (
        <div className="caution">
          <strong>掲載のきまり</strong>
          <p>{def.caution}</p>
          {def.officialLink && (
            <a href={def.officialLink.href}>{def.officialLink.label} →</a>
          )}
        </div>
      )}

      {kind && (
        <>
          <div className="field">
            <label htmlFor="org">団体・拠点の名称（必須）</label>
            <input id="org" type="text" value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="例: ○○地区自主防災会" />
          </div>
          <div className="field">
            <label htmlFor="contact">連絡先（必須）</label>
            <input id="contact" type="text" value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="電話番号・メール・SNSアカウントなど" />
            <p className="sub">
              連絡先のないお知らせは掲載できません。確認が取れないためです。
            </p>
          </div>
          <div className="field">
            <label htmlFor="title">見出し（必須）</label>
            <input id="title" type="text" value={title} maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 毛布と飲料水が不足しています" />
          </div>
          <div className="field">
            <label htmlFor="body">内容（必須・{body.length}/400）</label>
            <textarea id="body" rows={5} maxLength={400} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="品目・数量・受け取り可能な時間帯など、具体的に書いてください" />
          </div>
          <div className="field">
            <label htmlFor="muni">市町村</label>
            <select id="muni" value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}>
              <option value="">（指定しない）</option>
              {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>掲載期間</label>
            <div className="chips">
              {[3, 7, 14, 30].map((d) => (
                <button key={d} type="button"
                  className={`chip${days === d ? ' on' : ''}`}
                  onClick={() => setDays(d)}>{d}日間</button>
              ))}
            </div>
            <p className="sub">
              期限を過ぎたお知らせは自動で一覧から消えます。古い募集が残り続けないためです。
            </p>
          </div>

          {error && <p className="err">{error}</p>}

          <div className="sticky-cta">
            <button className="btn primary block" onClick={submit} disabled={!ready || sending}>
              {sending ? '送信中…' : 'お知らせを出す'}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 12 }}>
            投稿された内容は誰でも閲覧できます。運営が連絡先を確認できたものには
            「確認済み」を付けます。
          </p>
        </>
      )}
    </>
  );
}
