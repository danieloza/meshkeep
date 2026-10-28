import { getAuthMode } from '@/lib/server/auth-mode';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default function Home() {
  return <Dashboard authMode={getAuthMode()} />;
}
