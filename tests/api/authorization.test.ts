import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ID, ORIGIN, TOKENY, jako, jakoAgent, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba,
} from './harness';

// Testy regul dostepu na ZBUDOWANYM workerze, przez HTTP. Kazdy test niszczacy
// dostaje wlasna ofiare z zasiewu, wiec kolejnosc wykonania nie zmienia wyniku.
//
// Wzorzec, ktory powtarza sie ponizej: sprawdzamy nie tylko ODMOWE, ale i to, ze
// ta sama osoba moze wykonac operacje sasiednia. Sam kod odmowy nie dowodzi
// niczego - moglaby go zwrocic wygasla sesja albo literowka w sciezce.

beforeAll(async () => {
  zbudujJesliTrzeba();
  await startWorkera();
}, 300_000);

afterAll(() => {
  stopWorkera();
});

describe('tozsamosc i tryb', () => {
  it('zadanie bez ciasteczka jest odrzucane na kazdej trasie z danymi', async () => {
    for (const sciezka of ['/api/bootstrap', '/api/projects', '/api/conversations', '/api/usage', '/api/team']) {
      const odp = await zapytaj(sciezka);
      expect(odp.status, sciezka).toBe(401);
    }
  });

  it('kazdy token daje wlasna tozsamosc, a nie wspolna', async () => {
    const oczekiwane: Array<[string, string, string]> = [
      [TOKENY.wlasciciel, ID.wlasciciel, 'owner'],
      [TOKENY.edytor, ID.edytor, 'member'],
      [TOKENY.czytelnik, ID.czytelnik, 'member'],
      [TOKENY.obcy, ID.obcy, 'member'],
    ];
    for (const [token, id, rola] of oczekiwane) {
      const odp = await zapytaj('/api/bootstrap', { headers: jako(token) });
      expect(odp.status).toBe(200);
      const czlonek = odp.dane.member as { id: string; role: string };
      expect(czlonek.id).toBe(id);
      expect(czlonek.role).toBe(rola);
    }
  });

  it('konto zawieszone ma wazna sesje, a mimo to jest odrzucane', async () => {
    const odp = await zapytaj('/api/bootstrap', { headers: jako(TOKENY.zawieszony) });
    // 401, nie 403 - i tak jest poprawnie. `getSessionMember()` zwraca `null`
    // dla konta nieaktywnego, wiec zadanie spada do sciezki bez tozsamosci.
    // Komunikat mowi wtedy "zaloguj sie" zamiast "konto zawieszone", ale w
    // praktyce nikt tego nie zobaczy: zawieszenie kasuje sesje w tej samej
    // paczce zapytan, wiec taka sesja normalnie nie istnieje. Zasialem ja tu
    // recznie, zeby sprawdzic, ze sam status konta wystarczy do odmowy.
    expect(odp.status).toBe(401);
  });

  it('zmyslony token sesji nie wpuszcza', async () => {
    const odp = await zapytaj('/api/bootstrap', { headers: jako('x'.repeat(64)) });
    expect(odp.status).toBe(401);
  });
});

describe('widocznosc projektow', () => {
  async function widoczneProjekty(token: string): Promise<string[]> {
    const odp = await zapytaj('/api/projects', { headers: jako(token) });
    expect(odp.status).toBe(200);
    return (odp.dane.projects as Array<{ id: string }>).map((p) => p.id);
  }

  it('udostepniony projekt widza edytor i czytelnik', async () => {
    expect(await widoczneProjekty(TOKENY.edytor)).toContain(ID.projektWspolny);
    expect(await widoczneProjekty(TOKENY.czytelnik)).toContain(ID.projektWspolny);
  });

  it('obcy nie widzi ani projektu wspolnego, ani prywatnego wlasciciela', async () => {
    const widoczne = await widoczneProjekty(TOKENY.obcy);
    expect(widoczne).not.toContain(ID.projektWspolny);
    expect(widoczne).not.toContain(ID.projektPrywatnyWlasciciela);
    // ...ale swoj wlasny widzi, wiec puste zestawienie nie jest przyczyna.
    expect(widoczne).toContain(ID.projektPrywatnyObcego);
  });

  it('wlasciciel APLIKACJI nie jest superuzytkownikiem cudzych prywatnych projektow', async () => {
    expect(await widoczneProjekty(TOKENY.wlasciciel)).not.toContain(ID.projektPrywatnyObcego);
    const odp = await zapytaj(`/api/projects/${ID.projektPrywatnyObcego}/files`, { headers: jako(TOKENY.wlasciciel) });
    // 404, a nie 403: 403 potwierdzaloby istnienie projektu.
    expect(odp.status).toBe(404);
  });
});

describe('pliki', () => {
  it('czytelnik pobiera plik, ale go nie skasuje', async () => {
    const pobranie = await zapytaj(`/api/files/${ID.plikWspolny}`, { headers: jako(TOKENY.czytelnik) });
    expect(pobranie.status, 'czytelnik ma miec dostep do odczytu').toBe(200);

    const kasowanie = await zapytaj(`/api/files/${ID.plikWspolny}`, {
      method: 'DELETE', headers: { ...jako(TOKENY.czytelnik), ...ORIGIN },
    });
    expect(kasowanie.status, 'kasowanie wymaga prawa edycji').toBe(403);
  });

  it('edytor kasuje plik wgrany przez kogos innego', async () => {
    const odp = await zapytaj(`/api/files/${ID.plikKasowanyPrzezEdytora}`, {
      method: 'DELETE', headers: { ...jako(TOKENY.edytor), ...ORIGIN },
    });
    expect(odp.status).toBe(200);
  });

  it('wlasciciel aplikacji nie siega po plik z cudzego prywatnego projektu', async () => {
    for (const metoda of ['GET', 'DELETE']) {
      const odp = await zapytaj(`/api/files/${ID.plikObcego}`, {
        method: metoda, headers: { ...jako(TOKENY.wlasciciel), ...ORIGIN },
      });
      expect(odp.status, metoda).toBe(404);
    }
    // Wlasciciel pliku nadal go widzi, wiec 404 wyzej nie bierze sie stad, ze
    // plik po prostu nie istnieje.
    const wlasciciel = await zapytaj(`/api/files/${ID.plikObcego}`, { headers: jako(TOKENY.obcy) });
    expect(wlasciciel.status).toBe(200);
  });

  it('kasowanie bez naglowka Origin jest odrzucane', async () => {
    const odp = await zapytaj(`/api/files/${ID.plikWspolny}`, { method: 'DELETE', headers: jako(TOKENY.wlasciciel) });
    expect(odp.status).toBe(403);
  });
});

describe('rozmowy', () => {
  const trasa = (projekt: string, rozmowa: string) => `/api/projects/${projekt}/conversations?conversationId=${rozmowa}`;

  it('edytor czyta cudza rozmowe, ale jej nie kasuje', async () => {
    const odczyt = await zapytaj(trasa(ID.projektWspolny, ID.rozmowaWlasciciela), { headers: jako(TOKENY.edytor) });
    expect(odczyt.status, 'edytor ma dostep do odczytu').toBe(200);

    const kasowanie = await zapytaj(trasa(ID.projektWspolny, ID.rozmowaWlasciciela), {
      method: 'DELETE', headers: { ...jako(TOKENY.edytor), ...ORIGIN },
    });
    // Wezsze niz przy plikach: edytor nie kasuje cudzej historii czatu.
    expect(kasowanie.status, 'kasowanie wymaga autorstwa albo wlasnosci projektu').toBe(404);
  });

  it('autor kasuje wlasna rozmowe', async () => {
    const odp = await zapytaj(trasa(ID.projektWspolny, ID.rozmowaKasowanaPrzezAutora), {
      method: 'DELETE', headers: { ...jako(TOKENY.edytor), ...ORIGIN },
    });
    expect(odp.status).toBe(200);
  });

  it('wlasciciel projektu kasuje cudza rozmowe w swoim projekcie', async () => {
    const odp = await zapytaj(trasa(ID.projektWspolny, ID.rozmowaKasowanaPrzezWlasciciela), {
      method: 'DELETE', headers: { ...jako(TOKENY.wlasciciel), ...ORIGIN },
    });
    expect(odp.status).toBe(200);
  });

  it('obcy nie siega po rozmowe w projekcie, do ktorego nie ma dostepu', async () => {
    const odp = await zapytaj(trasa(ID.projektWspolny, ID.rozmowaWlasciciela), { headers: jako(TOKENY.obcy) });
    expect(odp.status).toBe(404);
  });
});

describe('trasy administracyjne', () => {
  const trasy = ['/api/admin/audit', '/api/admin/settings'];

  it('czlonek nie ma do nich dostepu', async () => {
    for (const sciezka of trasy) {
      const odp = await zapytaj(sciezka, { headers: jako(TOKENY.edytor) });
      expect(odp.status, sciezka).toBe(403);
    }
    const kopia = await zapytaj('/api/admin/backup', { headers: jako(TOKENY.edytor) });
    expect(kopia.status).toBe(403);
  });

  it('wlasciciel ma', async () => {
    for (const sciezka of trasy) {
      const odp = await zapytaj(sciezka, { headers: jako(TOKENY.wlasciciel) });
      expect(odp.status, sciezka).toBe(200);
    }
    const kopia = await zapytaj('/api/admin/backup', { headers: jako(TOKENY.wlasciciel) });
    expect(kopia.status).toBe(200);
  });

  it('kopia zapasowa nie zawiera skrotow tokenow', async () => {
    const odp = await zapytaj('/api/admin/backup', { headers: jako(TOKENY.wlasciciel) });
    const tabele = (odp.dane.tables ?? {}) as Record<string, Array<Record<string, unknown>>>;

    // Sprawdzamy STRUKTURE, nie szukamy napisu w calym pliku. Naiwne
    // `not.toContain('tokenHash')` zapalalo sie na polu `omitted.tokenHashes`,
    // czyli na opisie mowiacym, ze skrotow tu NIE MA - falszywy alarm na
    // wlasnej dokumentacji.
    for (const [nazwa, wiersze] of Object.entries(tabele)) {
      for (const wiersz of wiersze) {
        expect(Object.keys(wiersz), `${nazwa} nie moze niesc skrotu tokenu`).not.toContain('tokenHash');
      }
    }
    expect(Object.keys(tabele), 'sesji nie ma w kopii w ogole').not.toContain('sessions');
    // Zasiew ma zaproszenia i klucz agenta, wiec te tabele naprawde sa
    // sprawdzane, a nie puste.
    expect((tabele.syncTokens ?? []).length).toBeGreaterThan(0);
  });
});

describe('agent synchronizacji', () => {
  const trasaPlikow = `/api/projects/${ID.projektWspolny}/files`;
  const cialo = (sciezki: string[]) => JSON.stringify({ paths: sciezki });

  it('bez klucza i ze zlym kluczem nie wchodzi', async () => {
    const bezKlucza = await zapytaj(trasaPlikow, { method: 'DELETE', body: cialo(['x']) });
    expect(bezKlucza.status, 'brak Origin i brak klucza').toBe(403);

    const zlyKlucz = await zapytaj(trasaPlikow, {
      method: 'DELETE', headers: { ...jakoAgent(`meshkeep_${'q'.repeat(60)}`), 'Content-Type': 'application/json' }, body: cialo(['x']),
    });
    expect(zlyKlucz.status).toBe(401);
  });

  it('sufit chroni przed skasowaniem wiekszosci projektu', async () => {
    const lista = await zapytaj(`/api/projects/${ID.projektDoPrzyciecia}/files`, { headers: jako(TOKENY.wlasciciel) });
    const sciezki = (lista.dane.files as Array<{ relativePath: string }>).map((p) => p.relativePath);
    expect(sciezki.length, 'zasiew ma dac wiecej plikow niz prog dziesieciu').toBeGreaterThan(10);

    const zaDuzo = await zapytaj(`/api/projects/${ID.projektDoPrzyciecia}/files`, {
      method: 'DELETE', headers: { ...jakoAgent(), 'Content-Type': 'application/json' }, body: cialo(sciezki),
    });
    expect(zaDuzo.status, 'kasowanie calosci ma byc odrzucone').toBe(409);

    // Ta sama trasa, ten sam klucz, mniejsza porcja - przechodzi. Bez tego
    // 409 wyzej moglby wynikac z czegokolwiek innego.
    const w_sam_raz = await zapytaj(`/api/projects/${ID.projektDoPrzyciecia}/files`, {
      method: 'DELETE', headers: { ...jakoAgent(), 'Content-Type': 'application/json' }, body: cialo(sciezki.slice(0, 3)),
    });
    expect(w_sam_raz.status).toBe(200);
    expect(w_sam_raz.dane.deleted).toBe(3);
  });

  it('wylaczony przelacznik synchronizacji blokuje takze kasowanie', async () => {
    const przelacz = async (wlaczony: boolean) => {
      const odp = await zapytaj('/api/sync', {
        method: 'PUT',
        headers: { ...jako(TOKENY.wlasciciel), ...ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: wlaczony }),
      });
      expect(odp.status).toBe(200);
    };

    await przelacz(false);
    const zablokowane = await zapytaj(`/api/projects/${ID.projektDoPrzyciecia}/files`, {
      method: 'DELETE', headers: { ...jakoAgent(), 'Content-Type': 'application/json' }, body: cialo(['cokolwiek.txt']),
    });
    expect(zablokowane.status, 'wylaczona synchronizacja ma znaczyc wylaczona').toBe(403);

    await przelacz(true);
    const przepuszczone = await zapytaj(`/api/projects/${ID.projektDoPrzyciecia}/files`, {
      method: 'DELETE', headers: { ...jakoAgent(), 'Content-Type': 'application/json' }, body: cialo(['cokolwiek.txt']),
    });
    // Sciezka nie istnieje, wiec nic nie znika - ale zadanie przechodzi
    // autoryzacje. Roznica wzgledem 403 wyzej pochodzi wylacznie z przelacznika.
    expect(przepuszczone.status).toBe(200);
  });
});

describe('wyjscie do dostawcy modelu', () => {
  // Ten zestaw powstal po tym, jak okazalo sie, ze czat nie dzialal w ZADNEJ
  // wdrozonej wersji: `redirect: 'error'` nie jest zaimplementowane w workerd,
  // wiec runtime odrzucal zadanie przy jego tworzeniu i kazde wywolanie modelu
  // konczylo sie bledem 500, nie wychodzac w siec. Lint, typy, build i testy
  // reguł dostepu przechodzily przy tym na zielono.
  //
  // Nie sprawdzamy, czy model odpowiedzial - do tego trzeba prawdziwego klucza,
  // a test nie ma wykonywac platnych zapytan. Sprawdzamy jedno: ze zadanie
  // OPUSCILO nasz kod. Stad zbior dopuszczalnych statusow zamiast jednego:
  //   502 - dostawca odrzucil nieprawidlowy klucz (przypadek normalny tutaj)
  //   429 - dostawca ograniczyl liczbe zapytan
  //   200 - ktos uruchomil testy majac w `.dev.vars` prawdziwy klucz
  // Kazdy z nich znaczy, ze wyjscie dziala. 500 znaczy, ze nie.
  const dopuszczalne = [200, 429, 502];

  async function napisz(zalaczniki: string[] = []) {
    return zapytaj('/api/chat', {
      method: 'POST',
      headers: { ...jako(TOKENY.wlasciciel), ...ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: ID.projektWspolny,
        model: 'z-ai/glm-5.3-free',
        messages: [{ role: 'user', content: 'Test wyjscia do dostawcy.' }],
        attachmentIds: zalaczniki,
      }),
    });
  }

  it('zadanie do modelu opuszcza nasz kod', async () => {
    const odp = await napisz();
    expect(odp.status, 'kod 500 znaczy, ze zadanie peklo w runtime, zanim wyszlo w siec').not.toBe(500);
    expect(dopuszczalne, `nieoczekiwany status ${odp.status}: ${odp.tekst.slice(0, 200)}`).toContain(odp.status);
  });

  it('zalacznik PDF nie wywraca sciezki wyjscia', async () => {
    // Ekstrakcja PDF-a dzieje sie przed wywolaniem modelu, wiec jej awaria
    // objawilaby sie tak samo jak tamten blad: kodem 500 zamiast odpowiedzi
    // dostawcy. Ten sam zestaw statusow pilnuje obu.
    const odp = await napisz([ID.plikPdf]);
    expect(odp.status, 'kod 500 przy zalaczniku znaczy, ze pekla ekstrakcja albo wyjscie').not.toBe(500);
    expect(dopuszczalne, `nieoczekiwany status ${odp.status}: ${odp.tekst.slice(0, 200)}`).toContain(odp.status);
  });
});
