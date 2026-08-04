'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 「終了しました」の報告。投稿した端末にだけ出す。
 * 掲載期限を待たずに閉じられるようにしないと、
 * 充足済みの募集が残り続けて古い情報を配ることになる。
 */
export default function CloseNotice({ id }: { id: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/notices/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '終了にできませんでした');
        return;
      }
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="confirm">
      <span className="q">あなたが投稿したお知らせです</span>
      <button className="btn-sm" onClick={close} disabled={sending}>
        {sending ? '処理中…' : '終了しました'}
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
