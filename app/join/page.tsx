import { JoinForm } from './join-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <JoinForm token={token} />;
}
