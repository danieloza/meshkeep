import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { wydobadzTekstPdf } from '@/lib/server/pdf-text';

// PDF-a nie da sie odczytac naiwnie: przy czcionkach podzbiorowych bajty to
// numery glifow, a nie znaki. Dlatego korzystamy z pdf.js przez `unpdf`, a ten
// test pilnuje, ze opakowanie faktycznie zwraca tekst, a nie pusty wynik.
// Zgodnosc z workerd sprawdzona osobno, uruchomieniem biblioteki w wranglerze.
function wczytaj(nazwa: string): Uint8Array<ArrayBuffer> {
  const bufor = readFileSync(fileURLToPath(new URL(`./fixtures/${nazwa}`, import.meta.url)));
  return new Uint8Array(bufor.buffer.slice(bufor.byteOffset, bufor.byteOffset + bufor.byteLength));
}

describe('PDF', () => {
  it('wydobywa tekst ze wszystkich blokow strony', async () => {
    const { tekst, powod } = await wydobadzTekstPdf(wczytaj('umowa.pdf'));
    expect(powod).toBeUndefined();
    expect(tekst).toContain('Umowa serwisowa numer 2026/09/17');
    expect(tekst).toContain('Wynagrodzenie miesieczne: 4200 PLN netto.');
  });

  it('nie zostawia ciagow spacji, ktorymi pdf.js rozdziela fragmenty wiersza', async () => {
    const { tekst } = await wydobadzTekstPdf(wczytaj('umowa.pdf'));
    expect(tekst).not.toMatch(/ {2,}/);
    expect(tekst).not.toContain(' ');
  });

  it('plik, ktory nie jest PDF-em, daje powod zamiast wyjatku', async () => {
    const { tekst, powod } = await wydobadzTekstPdf(wczytaj('uszkodzony.docx'));
    expect(tekst).toBe('');
    expect(powod).toBeTruthy();
  });
});
