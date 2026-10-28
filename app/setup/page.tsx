import { notFound } from 'next/navigation';
import { getAuthMode } from '@/lib/server/auth-mode';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

// Behind OpenAI Sites the owner signs in with ChatGPT, so the setup key form
// does not exist there at all.
export default function SetupPage() {
  if (getAuthMode() !== 'standalone') notFound();
  return <SetupForm />;
}
