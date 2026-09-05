import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_LABELS, isSensitiveAction, serializeDetail } from '@/lib/audit';

describe('słownik zdarzeń', () => {
  it('każde zdarzenie ma polską etykietę', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_LABELS[action], action).toBeTruthy();
    }
  });

  it('odebranie dostępu jest oznaczane jako wrażliwe', () => {
    expect(isSensitiveAction('member.suspended')).toBe(true);
    expect(isSensitiveAction('settings.kill_switch_on')).toBe(true);
    expect(isSensitiveAction('project.deleted')).toBe(true);
    expect(isSensitiveAction('file.deleted')).toBe(true);
    expect(isSensitiveAction('member.joined')).toBe(false);
    expect(isSensitiveAction('cokolwiek.innego')).toBe(false);
  });
});

describe('serializeDetail — bariera przed wyciekiem treści', () => {
  it('przepuszcza proste wartości', () => {
    expect(serializeDetail({ dziennie: 400000, api: false, rodzaj: 'nowe' }))
      .toBe('{"dziennie":400000,"api":false,"rodzaj":"nowe"}');
  });

  it('wycina zagnieżdżone struktury — tędy wpadłaby cała wiadomość użytkownika', () => {
    expect(serializeDetail({ wiadomosc: { role: 'user', content: 'tajna treść rozmowy' } })).toBeNull();
    expect(serializeDetail({ historia: ['a', 'b'] })).toBeNull();
    expect(serializeDetail({ ok: 1, naglowki: { authorization: 'Bearer sekret' } })).toBe('{"ok":1}');
  });

  it('pomija wartości nieokreślone i puste obiekty', () => {
    expect(serializeDetail(undefined)).toBeNull();
    expect(serializeDetail({})).toBeNull();
    expect(serializeDetail({ a: undefined })).toBeNull();
  });

  it('przycina długie napisy i cały wpis', () => {
    const dlugi = serializeDetail({ tekst: 'x'.repeat(500) });
    expect(dlugi).not.toBeNull();
    expect(dlugi!.length).toBeLessThanOrEqual(400);
    expect(JSON.parse(dlugi!).tekst.length).toBe(80);
  });

  it('nie da się przemycić treści przez wiele pól — całość jest ucinana', () => {
    const wynik = serializeDetail(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, 'y'.repeat(80)])));
    expect(wynik!.length).toBeLessThanOrEqual(400);
  });
});
