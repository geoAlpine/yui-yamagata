'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 自分の報告を取り消す。
 *
 * 災害時は急いで押すので、押し間違いは必ず起きる。
 * 「品薄」のつもりが「休業」だった、を訂正できないのは実害がある。
 * 取り消しても履歴からは消さない（推移そのものが情報という設計は変えない）。
 */
export default function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/observations/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? '取り消せませんでした');
        return;
      }
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  if (!confirming) {
    return (
      <div className="confirm">
        <span className="q">内容が違っていたら取り消せます</span>
        <button className="btn-sm" onClick={() => setConfirming(true)}>
          取り消す
        </button>
      </div>
    );
  }

  return (
    <div className="confirm">
      <span className="q">この報告を取り消しますか？</span>
      <button className="btn-sm no" onClick={withdraw} disabled={sending}>
        {sending ? '処理中…' : '取り消す'}
      </button>
      <button className="btn-sm" onClick={() => setConfirming(false)}>
        やめる
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
