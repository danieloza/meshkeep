// Stend testów autoryzacji: buduje aplikację (jeśli trzeba), zakłada świeżą
// bazę D1 z migracji, zasiewa dane i uruchamia ZBUDOWANEGO workera, a testy
// pukają do niego po HTTP.
//
// Dlaczego nie mocki: sprawdzamy reguły dostępu, a te siedzą w zapytaniach SQL
// i w sesjach. Podstawiona baza albo podstawiona sesja udawałaby dokładnie to,
// co jest przedmiotem testu. Co gorsza, mock nie złapałby awaryjnej tożsamości
// `owner@sites.test`, która w trybie deweloperskim przepuszcza wszystko jako
// właściciela — a to ona dwa razy dała fałszywy wynik przy pracy ręcznej.
// Dlatego `waitForWorker` odmawia startu, dopóki żądanie bez ciasteczka nie
// zwróci 401.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PORT = 8813;
export const BASE = `http://127.0.0.1:${PORT}`;
export const ORIGIN = { Origin: BASE };

const KATALOG = resolve(import.meta.dirname, '../..');
const KONFIG_WORKERA = join(KATALOG, 'dist/server/wrangler.json');

// Tokeny sesji muszą mieć 40-100 znaków — krótsze `getSessionMember()` odrzuca
// przed policzeniem skrótu, więc test z krótkim tokenem dostaje mylące 401.
export const TOKENY = {
  wlasciciel: 'w'.repeat(64),
  edytor: 'e'.repeat(64),
  czytelnik: 'c'.repeat(64),
  obcy: 'o'.repeat(64),
  zawieszony: 'z'.repeat(64),
  agent: `meshkeep_${'a'.repeat(60)}`,
};

export const ID = {
  wlasciciel: '10000000-0000-4000-8000-000000000001',
  edytor: '10000000-0000-4000-8000-000000000002',
  czytelnik: '10000000-0000-4000-8000-000000000003',
  obcy: '10000000-0000-4000-8000-000000000004',
  projektWspolny: '20000000-0000-4000-8000-000000000001',
  projektPrywatnyWlasciciela: '20000000-0000-4000-8000-000000000002',
  projektPrywatnyObcego: '20000000-0000-4000-8000-000000000003',
  plikWspolny: '30000000-0000-4000-8000-000000000001',
  plikObcego: '30000000-0000-4000-8000-000000000002',
  zawieszony: '10000000-0000-4000-8000-000000000005',
  rozmowaWlasciciela: '40000000-0000-4000-8000-000000000001',
  rozmowaEdytora: '40000000-0000-4000-8000-000000000002',
  rozmowaObcego: '40000000-0000-4000-8000-000000000003',
  // Ofiary testow niszczacych. Osobne zasoby sprawiaja, ze kolejnosc
  // wykonania testow nie wplywa na wynik.
  plikKasowanyPrzezEdytora: '30000000-0000-4000-8000-000000000003',
  rozmowaKasowanaPrzezAutora: '40000000-0000-4000-8000-000000000004',
  rozmowaKasowanaPrzezWlasciciela: '40000000-0000-4000-8000-000000000005',
  projektDoPrzyciecia: '20000000-0000-4000-8000-000000000004',
  plikPdf: '30000000-0000-4000-8000-000000000009',
};

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

// `shell: true` jest na Windowsie konieczne, zeby npx sie rozwiazal, ale
// powoduje ponowne parsowanie argumentow przez powloke. Sciezka tego projektu
// zawiera spacje, wiec bez cytowania rozpadala sie na kawalki i wrangler
// dostawal smieci zamiast pliku.
function cytuj(argument: string): string {
  return argument.includes(' ') ? `"${argument}"` : argument;
}

function uruchom(polecenie: string, argumenty: string[], opis: string) {
  const wynik = spawnSync(polecenie, argumenty.map(cytuj), { cwd: KATALOG, encoding: 'utf8', shell: true });
  if (wynik.status !== 0) {
    throw new Error(`${opis} nie powiodło się:\n${wynik.stdout ?? ''}\n${wynik.stderr ?? ''}`);
  }
  return wynik.stdout ?? '';
}

// Budujemy tylko wtedy, gdy źródła są nowsze niż `dist`. Testowanie starego
// bundla dałoby fałszywe zielone światło, a budowanie za każdym razem
// wydłużyłoby przebieg o dwie minuty bez powodu.
function najnowszaZmiana(katalogi: string[]): number {
  let najnowsza = 0;
  const obejdz = (sciezka: string) => {
    for (const wpis of readdirSync(sciezka, { withFileTypes: true })) {
      if (wpis.name === 'node_modules' || wpis.name.startsWith('.')) continue;
      const pelna = join(sciezka, wpis.name);
      if (wpis.isDirectory()) obejdz(pelna);
      else najnowsza = Math.max(najnowsza, statSync(pelna).mtimeMs);
    }
  };
  for (const katalog of katalogi) {
    try { obejdz(join(KATALOG, katalog)); } catch { /* katalog może nie istnieć */ }
  }
  return najnowsza;
}

export function zbudujJesliTrzeba() {
  // Sieroty po przerwanym przebiegu trzymaja `dist` i build padlby na EPERM.
  ubijSieroty();
  let bundle = 0;
  try { bundle = statSync(KONFIG_WORKERA).mtimeMs; } catch { bundle = 0; }
  const zrodla = najnowszaZmiana(['app', 'lib', 'db', 'components', 'hooks']);
  if (bundle > zrodla) return 'aktualny';
  uruchom('npm', ['run', 'build'], 'Budowanie aplikacji');
  return 'zbudowany';
}

// Scenariusz pokrywa role, ktore maja rozne prawa: wlasciciel aplikacji, edytor
// i czytelnik w tym samym projekcie, ktos zupelnie obcy z wlasnym prywatnym
// projektem oraz konto zawieszone.
function seedSql(): string {
  const t = Date.now();
  const wygasa = t + 30 * 24 * 3600 * 1000;
  const czlonek = (id: string, email: string, nazwa: string, rola: string, status = 'active') =>
    `INSERT INTO members (id,provider_user_id,email,display_name,role,status,created_at,updated_at) VALUES ('${id}','p-${email}','${email}','${nazwa}','${rola}','${status}',${t},${t});`;
  const sesja = (id: string, token: string, czlonekId: string) =>
    `INSERT INTO sessions (id,token_hash,member_id,expires_at,created_at,last_seen_at) VALUES ('s-${id}','${sha(token)}','${czlonekId}',${wygasa},${t},${t});`;
  const projekt = (id: string, wlascicielId: string, nazwa: string, widocznosc: string) =>
    `INSERT INTO projects (id,owner_id,name,description,visibility,storage_provider,created_at,updated_at) VALUES ('${id}','${wlascicielId}','${nazwa}','','${widocznosc}','r2',${t},${t});`;
  const plik = (id: string, projektId: string, kto: string, sciezka: string) =>
    `INSERT INTO files (id,project_id,uploaded_by,object_key,relative_path,name,mime_type,size_bytes,sha256,created_at) VALUES ('${id}','${projektId}','${kto}','obj/${id}','${sciezka}','${sciezka.split('/').pop()}','text/plain',7,'x',${t});`;
  const rozmowa = (id: string, projektId: string, autor: string, tytul: string) =>
    `INSERT INTO conversations (id,project_id,created_by,title,created_at,updated_at) VALUES ('${id}','${projektId}','${autor}','${tytul}',${t},${t});`;

  return [
    czlonek(ID.wlasciciel, 'wlasciciel@test.local', 'Wlasciciel', 'owner'),
    czlonek(ID.edytor, 'edytor@test.local', 'Edytor', 'member'),
    czlonek(ID.czytelnik, 'czytelnik@test.local', 'Czytelnik', 'member'),
    czlonek(ID.obcy, 'obcy@test.local', 'Obcy', 'member'),
    czlonek(ID.zawieszony, 'zawieszony@test.local', 'Zawieszony', 'member', 'suspended'),
    `INSERT INTO member_limits (member_id,daily_tokens,monthly_tokens,enabled,updated_at) VALUES ('${ID.wlasciciel}',400000,8000000,1,${t}),('${ID.edytor}',400000,2000000,1,${t}),('${ID.czytelnik}',400000,2000000,1,${t}),('${ID.obcy}',400000,2000000,1,${t});`,
    sesja('w', TOKENY.wlasciciel, ID.wlasciciel),
    sesja('e', TOKENY.edytor, ID.edytor),
    sesja('c', TOKENY.czytelnik, ID.czytelnik),
    sesja('o', TOKENY.obcy, ID.obcy),
    sesja('z', TOKENY.zawieszony, ID.zawieszony),
    projekt(ID.projektWspolny, ID.wlasciciel, 'Projekt wspolny', 'selected'),
    projekt(ID.projektPrywatnyWlasciciela, ID.wlasciciel, 'Prywatny wlasciciela', 'private'),
    projekt(ID.projektPrywatnyObcego, ID.obcy, 'Prywatny obcego', 'private'),
    `INSERT INTO project_members (project_id,member_id,role,created_at) VALUES ('${ID.projektWspolny}','${ID.edytor}','editor',${t}),('${ID.projektWspolny}','${ID.czytelnik}','reader',${t});`,
    plik(ID.plikWspolny, ID.projektWspolny, ID.wlasciciel, 'wspolne/notatka.txt'),
    plik(ID.plikObcego, ID.projektPrywatnyObcego, ID.obcy, 'obce/sekret.txt'),
    rozmowa(ID.rozmowaWlasciciela, ID.projektWspolny, ID.wlasciciel, 'Rozmowa wlasciciela'),
    rozmowa(ID.rozmowaEdytora, ID.projektWspolny, ID.edytor, 'Rozmowa edytora'),
    rozmowa(ID.rozmowaObcego, ID.projektPrywatnyObcego, ID.obcy, 'Rozmowa obcego'),
    plik(ID.plikKasowanyPrzezEdytora, ID.projektWspolny, ID.wlasciciel, 'wspolne/do-skasowania.txt'),
    plik(ID.plikPdf, ID.projektWspolny, ID.wlasciciel, 'wspolne/umowa.pdf'),
    rozmowa(ID.rozmowaKasowanaPrzezAutora, ID.projektWspolny, ID.edytor, 'Rozmowa edytora do skasowania'),
    rozmowa(ID.rozmowaKasowanaPrzezWlasciciela, ID.projektWspolny, ID.edytor, 'Cudza rozmowa w projekcie wlasciciela'),
    projekt(ID.projektDoPrzyciecia, ID.wlasciciel, 'Projekt do przycinania', 'private'),
    // Dwanascie plikow, zeby przekroczyc prog dziesieciu, powyzej ktorego
    // serwer pilnuje, ile procent projektu znika w jednym zadaniu.
    ...Array.from({ length: 12 }, (_, i) =>
      plik(`30000000-0000-4000-8000-1000000000${String(i).padStart(2, '0')}`, ID.projektDoPrzyciecia, ID.wlasciciel, `przycinane/plik-${i}.txt`)),
    `INSERT INTO sync_tokens (id,token_hash,member_id,label,expires_at,created_at) VALUES ('st-1','${sha(TOKENY.agent)}','${ID.wlasciciel}','Test',${wygasa},${t});`,
    `INSERT INTO app_settings (key,value,updated_at) VALUES ('context_sync:${ID.wlasciciel}','on',${t});`,
  ].join('\n');
}

let proces: ChildProcess | null = null;
let katalogStanu = '';

export async function startWorkera() {
  // Stan miniflare MUSI lezec poza repozytorium. Uruchomienie z konfiguracji w
  // `dist/` bez `--persist-to` tworzy `dist/server/.wrangler/` z lokalna baza,
  // ktora potem jedzie do chmury razem z paczka wdrozeniowa.
  katalogStanu = mkdtempSync(join(tmpdir(), 'dops-testy-'));
  const wspolne = ['--local', '--persist-to', katalogStanu, '--config', KONFIG_WORKERA];

  const migracje = readdirSync(join(KATALOG, 'drizzle')).filter((n) => n.endsWith('.sql')).sort();
  for (const nazwa of migracje) {
    uruchom('npx', ['wrangler', 'd1', 'execute', 'site-creator-d1', ...wspolne, '--file', join(KATALOG, 'drizzle', nazwa)], `Migracja ${nazwa}`);
  }

  const seed = join(katalogStanu, 'seed.sql');
  writeFileSync(seed, seedSql(), 'utf8');
  uruchom('npx', ['wrangler', 'd1', 'execute', 'site-creator-d1', ...wspolne, '--file', seed], 'Zasianie danych');

  for (const id of [ID.plikWspolny, ID.plikObcego, ID.plikKasowanyPrzezEdytora]) {
    const zawartosc = join(katalogStanu, `${id}.txt`);
    writeFileSync(zawartosc, 'TRESC', 'utf8');
    uruchom('npx', ['wrangler', 'r2', 'object', 'put', `site-creator-r2/obj/${id}`, '--file', zawartosc, ...wspolne], 'Wgranie obiektu R2');
  }
  // Prawdziwy PDF z materialu testowego, a nie atrapa: inaczej ekstrakcja nie
  // wykonalaby sie naprawde i test sciezki zalacznika nic by nie znaczyl.
  uruchom('npx', ['wrangler', 'r2', 'object', 'put', `site-creator-r2/obj/${ID.plikPdf}`,
    '--file', join(KATALOG, 'tests', 'fixtures', 'umowa.pdf'), ...wspolne], 'Wgranie PDF-a do R2');

  await podnieProces();
}

function podnieProces() {
  proces = spawn('npx', [
    'wrangler', 'dev', '--config', KONFIG_WORKERA, '--persist-to', katalogStanu,
    '--port', String(PORT), '--ip', '127.0.0.1',
    // Bez ustawionego klucza `callTokenRouter` odrzuca zadanie wlasnym bledem
    // 503, zanim dojdzie do fetcha - i test sciezki wyjscia nie sprawdzalby
    // niczego. Wartosc jest celowo nieprawidlowa, zeby dostawca ja odrzucil.
    '--var', 'TOKENROUTER_API_KEY:klucz-testowy-nieprawidlowy',
  ].map(cytuj), {
    cwd: KATALOG, shell: true, stdio: 'ignore',
  });
  return czekajNaWorkera();
}

// `wrangler dev` na Windowsie potrafi zerwac polaczenie miedzy swoim proxy a
// procesem workerd. Objawia sie to odpowiedzia 500, ktorej tresc pochodzi z
// `miniflare/.../entry.worker.js`, a nie z naszego kodu - handler nawet sie nie
// wykonuje. Zdiagnozowane osobno: to samo zadanie powtorzone recznie zwraca
// poprawny status.
//
// Ponawiamy WYLACZNIE ta sygnature. Ponawianie kazdego 500 zamaskowaloby
// prawdziwy blad serwera, czyli dokladnie to, co te testy maja lapac.
function awariaTransportu(status: number, tresc: string): boolean {
  return status === 500 && tresc.includes('Network connection lost') && tresc.includes('entry.worker');
}

async function zyje(): Promise<boolean> {
  try {
    const odp = await fetch(`${BASE}/api/bootstrap`, { signal: AbortSignal.timeout(2000) });
    return odp.status === 401;
  } catch { return false; }
}

async function czekajNaWorkera() {
  for (let proba = 0; proba < 60; proba += 1) {
    try {
      const odpowiedz = await fetch(`${BASE}/api/bootstrap`, { signal: AbortSignal.timeout(2000) });
      // Straznik trybu. W trybie deweloperskim `requireMember()` podstawia
      // tozsamosc `owner@sites.test` i KAZDY test autoryzacji przeszedlby jako
      // wlasciciel - caly zestaw swiecilby na zielono, nie sprawdzajac niczego.
      // Lepiej wywalic sie tutaj i glosno.
      if (odpowiedz.status === 200) {
        throw new Error('Worker odpowiada 200 na zadanie bez ciasteczka. To tryb deweloperski z awaryjna tozsamoscia - testy autoryzacji byłyby bezwartosciowe.');
      }
      if (odpowiedz.status === 401) return;
    } catch (blad) {
      if (blad instanceof Error && blad.message.includes('tryb deweloperski')) throw blad;
    }
    await new Promise((gotowe) => setTimeout(gotowe, 500));
  }
  throw new Error(`Worker nie wstal na ${BASE} w ciagu 30 sekund.`);
}

// `proces.kill()` przy `shell: true` zabija POWLOKE, a nie lancuch
// npx -> wrangler -> workerd, ktory pod nia wisi. Zostawiony workerd trzyma
// uchwyt do `dist`, przez co NASTEPNY przebieg nie moze przebudowac aplikacji i
// wywala sie na EPERM. Zestaw testow, ktory zatruwa wlasny kolejny przebieg,
// jest bezuzyteczny, wiec ubijamy cale drzewo procesow po identyfikatorze.
function ubijDrzewo() {
  if (proces?.pid) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(proces.pid)], { shell: true, stdio: 'ignore' });
  }
  proces = null;
  ubijSieroty();
}

// Ubijanie po PID powloki nie wystarcza: lancuch npx -> wrangler -> workerd
// bywa przepiety do innego rodzica i przezywa `taskkill /T`. Zostawiony proces
// trzyma uchwyt do `dist`, przez co NASTEPNY przebieg nie moze przebudowac
// aplikacji i wywala sie na EPERM.
//
// Celujemy w numer portu, a nie w slowo "wrangler". To wazne: zabicie
// wszystkiego z wranglerem w linii polecen ubiloby takze serwer deweloperski
// uruchomiony recznie przez czlowieka, ktory akurat odpalil testy.
export function ubijSieroty() {
  const polecenie = [
    `Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"`,
    `Where-Object { $_.CommandLine -like '*--port ${PORT}*' }`,
    `ForEach-Object { taskkill /F /T /PID $_.ProcessId 2>$null }`,
  ].join(' | ');
  spawnSync('powershell', ['-NoProfile', '-Command', `"${polecenie}"`], { shell: true, stdio: 'ignore' });
}

export function stopWorkera() {
  ubijDrzewo();
  if (katalogStanu) {
    try { rmSync(katalogStanu, { recursive: true, force: true }); } catch { /* Windows bywa uparty z uchwytami */ }
    katalogStanu = '';
  }
}

// --- pomocniki zadan -------------------------------------------------------

export function jako(token: string): Record<string, string> {
  return { Cookie: `meshkeep_session=${token}` };
}

export function jakoAgent(token: string = TOKENY.agent): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export type Odpowiedz = { status: number; dane: Record<string, unknown>; tekst: string };

export async function zapytaj(sciezka: string, opcje: RequestInit = {}): Promise<Odpowiedz> {
  for (let proba = 0; ; proba += 1) {
    let odpowiedz: Response;
    let tekst: string;
    try {
      odpowiedz = await fetch(`${BASE}${sciezka}`, opcje);
      tekst = await odpowiedz.text();
    } catch (blad) {
      // Worker padl calkiem i polaczenie jest odrzucane. To druga postac tej
      // samej awarii wranglera co `awariaTransportu` - tam proxy zyje i zwraca
      // 500, tutaj nie ma juz czego pytac.
      if (proba >= 2) throw blad;
      ubijDrzewo();
      await podnieProces();
      continue;
    }

    if (proba < 2 && awariaTransportu(odpowiedz.status, tekst)) {
      if (!(await zyje())) {
        ubijDrzewo();
        await podnieProces();
      }
      continue;
    }

    let dane: unknown = null;
    try { dane = JSON.parse(tekst); } catch { dane = { surowe: tekst }; }
    return { status: odpowiedz.status, dane: dane as Record<string, unknown>, tekst };
  }
}
