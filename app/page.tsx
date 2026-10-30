import { getAuthMode } from '@/lib/server/auth-mode';
import { sectionFromLocation } from '@/lib/navigation';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const params = await searchParams;
  const view = typeof params.view === 'string' ? params.view : '';
  return <Dashboard authMode={getAuthMode()} initialSection={sectionFromLocation('/', view ? `?view=${encodeURIComponent(view)}` : '')} />;
}
