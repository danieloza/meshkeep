import { describe, expect, it } from 'vitest';
import {
  contentMatchesExtension,
  isAllowedUpload,
  MAX_FILE_BYTES,
  safeRelativePath,
  UnsafePathError,
} from '@/lib/file-guards';

function reasonOf(path: string) {
  try {
    safeRelativePath(path);
    return 'accepted';
  } catch (error) {
    return error instanceof UnsafePathError ? error.reason : 'other';
  }
}

describe('safeRelativePath', () => {
  it('normalizuje separatory Windows i obcina wiodące ukośniki', () => {
    expect(safeRelativePath('src\\lib\\index.ts')).toBe('src/lib/index.ts');
    expect(safeRelativePath('/src/index.ts')).toBe('src/index.ts');
    expect(safeRelativePath('///src/index.ts')).toBe('src/index.ts');
  });

  it('odrzuca wyjście poza katalog projektu', () => {
    expect(reasonOf('../../../etc/passwd')).toBe('invalid');
    expect(reasonOf('src/../../secret.txt')).toBe('invalid');
    expect(reasonOf('src\\..\\..\\secret.txt')).toBe('invalid');
    expect(reasonOf('./index.ts')).toBe('invalid');
    expect(reasonOf('src//index.ts')).toBe('invalid');
    expect(reasonOf('')).toBe('invalid');
  });

  it('odrzuca katalogi techniczne niezależnie od wielkości liter', () => {
    expect(reasonOf('node_modules/pkg/index.js')).toBe('blocked');
    expect(reasonOf('.git/config')).toBe('blocked');
    expect(reasonOf('app/.SSH/known_hosts')).toBe('blocked');
    expect(reasonOf('projekt/Node_Modules/a.js')).toBe('blocked');
  });

  it('odrzuca pliki wyglądające na sekrety', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.dev.vars',
      '.dev.vars.production',
      'credentials.json',
      'service-account.json',
      'service_account.prod.json',
      'token.json',
      'secret.json',
      'secrets.json',
      'id_rsa',
      'id_ed25519',
      'cert.pem',
      'private.KEY',
      'store.p12',
      'store.pfx',
    ]) {
      expect(reasonOf(`konfiguracja/${name}`), name).toBe('blocked');
    }
  });

  it('przepuszcza zwykłe pliki projektu', () => {
    expect(safeRelativePath('src/components/Button.tsx')).toBe('src/components/Button.tsx');
    expect(safeRelativePath('notatki/plan.md')).toBe('notatki/plan.md');
    // Nazwa tylko przypominająca sekret, ale nietrafiająca we wzorzec.
    expect(safeRelativePath('docs/environment.md')).toBe('docs/environment.md');
  });

  it('pilnuje limitów długości', () => {
    expect(reasonOf(`${'a'.repeat(151)}.txt`)).toBe('invalid');
    expect(reasonOf(`${'a/'.repeat(260)}plik.txt`)).toBe('invalid');
  });
});

describe('isAllowedUpload', () => {
  it('akceptuje dozwolone rozszerzenia w granicach rozmiaru', () => {
    expect(isAllowedUpload('src/index.ts', 1024)).toBe(true);
    expect(isAllowedUpload('obraz.PNG', 1024)).toBe(true);
    expect(isAllowedUpload('src/index.ts', MAX_FILE_BYTES)).toBe(true);
  });

  it('odrzuca niedozwolone typy i rozmiary', () => {
    expect(isAllowedUpload('program.exe', 1024)).toBe(false);
    expect(isAllowedUpload('biblioteka.dll', 1024)).toBe(false);
    expect(isAllowedUpload('bezrozszerzenia', 1024)).toBe(false);
    expect(isAllowedUpload('src/index.ts', 0)).toBe(false);
    expect(isAllowedUpload('src/index.ts', MAX_FILE_BYTES + 1)).toBe(false);
  });
});

describe('contentMatchesExtension', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  it('rozpoznaje zgodną zawartość', () => {
    expect(contentMatchesExtension('obraz.png', png)).toBe(true);
    expect(contentMatchesExtension('paczka.zip', zip)).toBe(true);
    expect(contentMatchesExtension('umowa.docx', zip)).toBe(true);
    expect(contentMatchesExtension('raport.pdf', pdf)).toBe(true);
  });

  it('wykrywa podszywanie się pod typ binarny', () => {
    expect(contentMatchesExtension('obraz.png', zip)).toBe(false);
    expect(contentMatchesExtension('raport.pdf', png)).toBe(false);
    expect(contentMatchesExtension('paczka.zip', pdf)).toBe(false);
    expect(contentMatchesExtension('obraz.png', new Uint8Array([]))).toBe(false);
  });

  it('nie blokuje plików tekstowych, dla których nie ma sygnatury', () => {
    expect(contentMatchesExtension('notatka.md', new Uint8Array([0x23, 0x20]))).toBe(true);
    expect(contentMatchesExtension('skrypt.ts', new Uint8Array([0x69, 0x6d]))).toBe(true);
  });
});
