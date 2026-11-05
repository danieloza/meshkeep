// What the owner typed or pasted into the invite field, sorted into the
// addresses that get a link and what to say about the rest.
//
// A new address reserves one of the team's seats. A member's own address gets
// a reconnect link instead and takes no seat. An address that already has an
// unused link gets a new one from the list below, not from the field.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteContext = {
  // Addresses that belong to members of the team.
  members: ReadonlySet<string>;
  // Addresses with an unused invitation or reconnect link.
  waiting: ReadonlySet<string>;
  // Seats that are neither taken nor reserved.
  freeSeats: number;
};

export type AddedAddresses = {
  // Everything ready for a link: what was there before plus what fits.
  addresses: string[];
  // What stays in the field because it is not an address.
  rest: string;
  // What to tell the owner, or '' when everything went in.
  problem: string;
};

export function seatsFor(addresses: readonly string[], members: ReadonlySet<string>): number {
  return addresses.filter((address) => !members.has(address)).length;
}

const listed = (items: string[]) => items.join(', ');

export function addAddresses(raw: string, current: readonly string[], context: InviteContext): AddedAddresses {
  const addresses = [...current];
  const notAddresses: string[] = [];
  const waiting: string[] = [];
  const noSeat: string[] = [];
  for (const part of raw.split(/[\s,;]+/).map((value) => value.trim().toLocaleLowerCase('en-US')).filter(Boolean)) {
    if (!EMAIL.test(part)) notAddresses.push(part);
    else if (addresses.includes(part)) continue;
    else if (context.waiting.has(part)) waiting.push(part);
    else if (!context.members.has(part) && seatsFor(addresses, context.members) >= context.freeSeats) noSeat.push(part);
    else addresses.push(part);
  }

  let problem = '';
  if (notAddresses.length) {
    problem = notAddresses.length === 1 ? `“${notAddresses[0]}” isn’t a full email address.` : `These aren’t full email addresses: ${listed(notAddresses)}.`;
  } else if (noSeat.length) {
    problem = context.freeSeats === 0
      ? `Every seat is taken or reserved, so ${listed(noSeat)} can’t join. Revoke a link below to free a seat.`
      : `Only ${context.freeSeats} ${context.freeSeats === 1 ? 'seat is' : 'seats are'} free, so ${listed(noSeat)} ${noSeat.length === 1 ? 'was' : 'were'} left out.`;
  } else if (waiting.length) {
    problem = `${listed(waiting)} already ${waiting.length === 1 ? 'has' : 'have'} a link. Make a new one in the list below.`;
  }
  return { addresses, rest: notAddresses.join(', '), problem };
}
