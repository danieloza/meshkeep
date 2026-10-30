import { getAuthMode } from '@/lib/server/auth-mode';
import { sectionFromLocation, SETTINGS_PATH } from '@/lib/navigation';
import { Dashboard } from '../dashboard';

export const dynamic = 'force-dynamic';

// The same workspace component as `/`, opened on a settings section. The view
// is read here too, so the first render already shows the right section.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const params = await searchParams;
  const view = typeof params.view === 'string' ? params.view : '';
  return <Dashboard authMode={getAuthMode()} initialSection={sectionFromLocation(SETTINGS_PATH, view ? `?view=${encodeURIComponent(view)}` : '')} />;
}
