import 'server-only';

import { extractText, getDocumentProxy } from 'unpdf';
import type { WynikEkstrakcji } from '@/lib/document-text';

// PDF-y, w odroznieniu od DOCX-ow, nie daja sie odczytac bez prawdziwego
// parsera. Tekst siedzi w strumieniach z wlasnym kodowaniem czcionek, a przy
// czcionkach podzbiorowych - powszechnych w polskich dokumentach - bajty sa
// numerami glifow i bez mapy ToUnicode daja smieci. Recznie napisany
// ekstraktor wygladalby na dzialajacy i cicho psul co drugi plik, wiec
// korzystamy z `unpdf` (opakowanie pdf.js przygotowane pod Workery, zero
// wlasnych zaleznosci).
//
// Ten modul jest w `lib/server`, bo pdf.js nie da sie sensownie uruchomic w
// zwyklym tescie jednostkowym - inaczej niz reszta ekstrakcji w
// `lib/document-text.ts`.

// Limity chronia czas procesora Workera. Dokument na kilkaset stron zjadlby go
// w calosci, a do kontekstu modelu i tak trafia najwyzej kilkadziesiat tysiecy
// znakow.
const MAKS_STRON = 40;
const MAKS_ZNAKOW = 120_000;

export async function wydobadzTekstPdf(bajty: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  try {
    const dokument = await getDocumentProxy(bajty);
    const strony = dokument.numPages;
    const { text } = await extractText(dokument, { mergePages: true });

    const surowy = Array.isArray(text) ? text.join('\n') : text;
    // pdf.js zwraca duzo pojedynczych spacji i twardych spacji miedzy
    // fragmentami wiersza; bez tego kontekst puchnie od bialych znakow.
    const czysty = surowy
      .replaceAll('\u00a0', ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!czysty) {
      return {
        tekst: '',
        powod: strony > 0
          ? 'This PDF has no text layer and is probably a scan. Optical character recognition is not implemented.'
          : 'Could not read the document pages.',
      };
    }

    const przyciety = czysty.length > MAKS_ZNAKOW ? `${czysty.slice(0, MAKS_ZNAKOW)}\n[...]` : czysty;
    if (strony > MAKS_STRON) {
      return { tekst: przyciety, powod: `The document has ${strony} pages; only text from the beginning was added to context.` };
    }
    return { tekst: przyciety };
  } catch (blad) {
    return { tekst: '', powod: `Could not read the PDF: ${blad instanceof Error ? blad.message : 'unknown error'}.` };
  }
}
