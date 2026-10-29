import 'server-only';

import { env } from 'cloudflare:workers';
import { ROZSZERZENIA_BEZ_WSPARCIA, ROZSZERZENIA_DOKUMENTOW, wydobadzTekstDokumentu, type WynikEkstrakcji } from '@/lib/document-text';
import { wydobadzTekstPdf } from './pdf-text';

// Shared by chat context and the search index, so a file the model can read is
// exactly a file search can find, and both give the same reason when not.

// `rtf` bylo tu wczesniej, wiec model dostawal `\\rtf1\\ansi\\deff0{\\fonttbl...`
// zamiast tresci. Teraz idzie przez ekstrakcje razem z pozostalymi dokumentami.
const TEXT_CONTEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py',
  'go', 'rs', 'java', 'kt', 'swift', 'css', 'scss', 'html', 'xml', 'yaml',
  'yml', 'toml', 'sql', 'sh', 'ps1', 'bat',
]);
const MAX_CONTEXT_FILE_BYTES = 300_000;
// Dokumenty sa skompresowane, wiec limit bajtow moze byc znacznie wyzszy niz
// przy zwyklym tekscie: kilkumegabajtowy DOCX rozpakowuje sie do kilkudziesieciu
// tysiecy znakow. O rozmiarze kontekstu i tak decyduje wywolujacy.
const MAX_DOCUMENT_BYTES = 8_000_000;

export function rozszerzeniePliku(nazwa: string): string {
  return nazwa.split('.').pop()?.toLocaleLowerCase('en-US') ?? '';
}

export function jestZwyklymTekstem(rozszerzenie: string): boolean {
  return TEXT_CONTEXT_EXTENSIONS.has(rozszerzenie);
}

export function jestDokumentem(rozszerzenie: string): boolean {
  return ROZSZERZENIA_DOKUMENTOW.has(rozszerzenie) || rozszerzenie === 'pdf';
}

type PlikProjektu = { objectKey: string; sizeBytes: number };

// Zwraca tresc albo powod, dla ktorego jej nie ma. Powod trafia do kontekstu
// zamiast tresci, zeby model wiedzial, ze plik istnieje, ale jest nieczytelny -
// bez tego zgaduje, czemu zalacznik jest pusty. Wysylka przekazuje `bajty`, bo
// ma je juz w pamieci; pozostali czytaja z R2.
export async function trescPliku(plik: PlikProjektu, rozszerzenie: string, bajty?: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  const zwykly = jestZwyklymTekstem(rozszerzenie);
  const dokument = jestDokumentem(rozszerzenie);

  if (ROZSZERZENIA_BEZ_WSPARCIA.has(rozszerzenie)) {
    return { tekst: '', powod: `Legacy binary format (.${rozszerzenie}) cannot be read. Save it as .docx, .xlsx or .pptx.` };
  }
  if (!zwykly && !dokument) {
    return { tekst: '', powod: 'This file type is not converted to text. The file remains stored in the project.' };
  }

  const limit = zwykly ? MAX_CONTEXT_FILE_BYTES : MAX_DOCUMENT_BYTES;
  if (plik.sizeBytes > limit) {
    return { tekst: '', powod: `The file exceeds the ${Math.round(limit / 1000)} kB limit for this type.` };
  }

  let zawartosc = bajty;
  if (!zawartosc) {
    const obiekt = await env.FILES.get(plik.objectKey);
    if (!obiekt) return { tekst: '', powod: 'The file is no longer in storage.' };
    zawartosc = new Uint8Array(await obiekt.arrayBuffer());
  }

  if (zwykly) return { tekst: new TextDecoder().decode(zawartosc).replaceAll('\0', '') };
  return rozszerzenie === 'pdf'
    ? wydobadzTekstPdf(zawartosc)
    : wydobadzTekstDokumentu(rozszerzenie, zawartosc);
}
