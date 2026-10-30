import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { EffectiveProvider, ProviderOrigin } from '@/lib/contracts/providers';

export const ORIGIN_LABEL: Record<ProviderOrigin, string> = {
  member: 'your own key',
  team: "the team's key",
  environment: 'a key set on the server',
};

// The dashboard and usage view describe the same provider, so they read the
// same server state. The dashboard used to hard-code a provider name and could
// contradict the provider card after bring-your-own-provider was configured.
export function useEffectiveProvider(): { effective: EffectiveProvider | null; loaded: boolean } {
  const [effective, setEffective] = useState<EffectiveProvider | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api.provider.get()
      .then((payload) => { if (active) setEffective(payload.effective); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  return { effective, loaded };
}
