import Link from 'next/link';
import NoticeForm from '@/components/NoticeForm';

export const dynamic = 'force-dynamic';

export default function NewNoticePage() {
  return (
    <>
      <p style={{ marginTop: 14 }}>
        <Link href="/notices">← お知らせ一覧</Link>
      </p>
      <NoticeForm />
    </>
  );
}
