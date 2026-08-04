import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSpot } from '@/lib/queries';
import ReportForm from '@/components/ReportForm';

export const dynamic = 'force-dynamic';

export default async function ReportPage({
  params,
}: {
  params: Promise<{ spotId: string }>;
}) {
  const { spotId } = await params;
  const spot = await getSpot(spotId);
  if (!spot) notFound();

  return (
    <>
      <p style={{ marginTop: 14 }}>
        <Link href={`/spots/${spot.id}`}>← {spot.name}</Link>
      </p>
      <ReportForm
        spotId={spot.id}
        spotName={spot.name}
        category={spot.category}
      />
    </>
  );
}
