import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteResponse, teamResponse } from '@/lib/contracts/team';
import { ORIGIN, jako, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from './harness';

// Zaproszenia na pelnym zespole: wlasciciel, dwoje czlonkow i jedno
// niewykorzystane zaproszenie, czyli cztery z czterech miejsc. Wlasny zasiew,
// bo wspolny ma piec kont i nie zostawia miejsca na zadne zaproszenie.

const TOKEN = 'team-invites-owner-session-token-0123456789abcdef';
const OWNER = '40000000-0000-4000-8000-000000000001';
const INVITE = '40000000-0000-4000-8000-0000000000aa';
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function seed() {
  const t = Date.now();
  const later = t + 7 * 24 * 3600 * 1000;
  const member = (id: string, email: string, name: string, role: string) =>
    `INSERT INTO members (id,provider_user_id,email,display_name,role,status,created_at,updated_at) VALUES ('${id}','p-${email}','${email}','${name}','${role}','active',${t},${t});`;
  return [
    member(OWNER, 'owner@test.local', 'Owner', 'owner'),
    member('40000000-0000-4000-8000-000000000002', 'ana@test.local', 'Ana', 'member'),
    member('40000000-0000-4000-8000-000000000003', 'tom@test.local', 'Tom', 'member'),
    `INSERT INTO sessions (id,token_hash,member_id,expires_at,created_at,last_seen_at) VALUES ('s-owner','${sha(TOKEN)}','${OWNER}',${later},${t},${t});`,
    `INSERT INTO invites (id,email,token_hash,created_by,expires_at,created_at) VALUES ('${INVITE}','kim@example.com','${sha('old-link-token')}','${OWNER}',${later},${t});`,
  ].join('\n');
}

beforeAll(async () => {
  zbudujJesliTrzeba();
  await startWorkera({ zasiej: false, dodatkowySql: seed() });
}, 300_000);

afterAll(() => {
  stopWorkera();
});

const invite = (email: string) => zapytaj('/api/team', {
  method: 'POST',
  headers: { ...jako(TOKEN), ...ORIGIN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email }),
});

describe('zaproszenia na pelnym zespole', () => {
  it('nowa osoba nie dostaje linku, bo miejsc nie ma', async () => {
    const odp = await invite('lee@example.com');
    expect(odp.status).toBe(409);
  });

  it('nowy link dla zaproszenia, ktore juz trzyma miejsce, przechodzi i zachowuje jego id', async () => {
    const odp = await invite('kim@example.com');
    expect(odp.status).toBe(201);
    const { invite: link } = inviteResponse.parse(odp.dane);
    expect(link.id).toBe(INVITE);
    expect(link.kind).toBe('invite');

    const team = teamResponse.parse((await zapytaj('/api/team', { headers: jako(TOKEN) })).dane);
    expect(team.pendingInvites.map((item) => item.id)).toEqual([INVITE]);
    expect(team.capacity).toEqual({ used: 4, total: 4 });
  });

  it('adres czlonka dostaje link ponownego dostepu mimo pelnego zespolu', async () => {
    const odp = await invite('ana@test.local');
    expect(odp.status).toBe(201);
    expect(inviteResponse.parse(odp.dane).invite.kind).toBe('reconnect');
  });
});
