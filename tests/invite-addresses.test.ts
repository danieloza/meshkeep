import { describe, expect, it } from 'vitest';
import { addAddresses, seatsFor } from '@/features/team/invite-addresses';

const context = (freeSeats: number) => ({
  members: new Set(['ana@example.com']),
  waiting: new Set(['tom@example.com']),
  freeSeats,
});

describe('addresses typed into the invite field', () => {
  it('takes a pasted list, in any case and with any separator', () => {
    expect(addAddresses('Kim@Example.com, lee@example.com;\nmo@example.com', [], context(3))).toEqual({
      addresses: ['kim@example.com', 'lee@example.com', 'mo@example.com'], rest: '', problem: '',
    });
  });

  it('keeps what is not an address in the field and says so', () => {
    expect(addAddresses('kim@example.com kim', [], context(3))).toEqual({
      addresses: ['kim@example.com'], rest: 'kim', problem: '“kim” isn’t a full email address.',
    });
    expect(addAddresses('a b', [], context(3)).problem).toBe('These aren’t full email addresses: a, b.');
  });

  it('adds an address once', () => {
    expect(addAddresses('kim@example.com', ['kim@example.com'], context(3)).addresses).toEqual(['kim@example.com']);
  });

  it('stops at the free seats, but lets a member through for a reconnect link', () => {
    const full = addAddresses('kim@example.com lee@example.com ana@example.com', [], context(1));
    expect(full.addresses).toEqual(['kim@example.com', 'ana@example.com']);
    expect(full.problem).toBe('Only 1 seat is free, so lee@example.com was left out.');
    expect(seatsFor(full.addresses, context(1).members)).toBe(1);

    expect(addAddresses('kim@example.com', [], context(0)).problem).toBe('Every seat is taken or reserved, so kim@example.com can’t join. Revoke a link below to free a seat.');
  });

  it('points an address that already has a link to the list', () => {
    expect(addAddresses('tom@example.com', [], context(3))).toEqual({
      addresses: [], rest: '', problem: 'tom@example.com already has a link. Make a new one in the list below.',
    });
  });
});
