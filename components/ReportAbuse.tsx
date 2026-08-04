'use client';

import { useState } from 'react';

/**
 * 通報。
 *
 * 事前審査をしない設計なので、利用者が「これはおかしい」と言える口が必要になる。
 * ただしここで即時削除はしない。押した瞬間に消せると、それ自体が
 * 正しい情報を消す手段になってしまう。管理画面のキューに積むだけにする。
 */
const REASONS = [
  '事実と違う',
  'いたずら・荒らし',
  '個人情報が含まれている',
  '危険な誘導',
];

export default function ReportAbuse({
  observationId,
  spotId,
}: {
  observationId?: string;
  spotId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);

  async function send(reason: string) {
    if (sending) return;
    setSending(true);
    try {
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ observationId, spotId, reason }),
      });
      setDone(true);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <p className="sub" style={{ marginTop: 14 }}>
        通報を受け付けました。運営が確認します。すぐには消えません。
      </p>
    );
  }

  if (!open) {
    return (
      <p style={{ marginTop: 14 }}>
        <button className="linkish" onClick={() => setOpen(true)}>
          この情報を通報する
        </button>
      </p>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <p className="sub" style={{ marginBottom: 10 }}>
        理由を選んでください。運営が確認するまで表示は消えません。
      </p>
      <div className="chips">
        {REASONS.map((r) => (
          <button key={r} className="chip" onClick={() => send(r)} disabled={sending}>
            {r}
          </button>
        ))}
      </div>
      <p style={{ marginTop: 10 }}>
        <button className="linkish" onClick={() => setOpen(false)}>やめる</button>
      </p>
    </div>
  );
}
