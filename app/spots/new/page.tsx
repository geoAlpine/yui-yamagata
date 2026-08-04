import Link from 'next/link';
import { getMode } from '@/lib/queries';
import SpotForm from '@/components/SpotForm';

export const dynamic = 'force-dynamic';

export default async function NewSpotPage() {
  const { mode } = await getMode();
  return (
    <>
      <p style={{ marginTop: 14 }}>
        <Link href="/">← 一覧にもどる</Link>
      </p>
      <SpotForm mode={mode} />
    </>
  );
}
