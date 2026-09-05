// Czyste reguły walidacji files. Świadomie bez `server-only` i bez importów
// z `cloudflare:workers`, żeby dało się je testować jednostkowo poza Workerem —
// to najbardziej wrażliwa część uploadu (traversal, sekrety, podszywanie typu).

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 100;

export const ALLOWED_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py',
  'go', 'rs', 'java', 'kt', 'swift', 'css', 'scss', 'html', 'xml', 'yaml',
  'yml', 'toml', 'sql', 'sh', 'ps1', 'bat', 'zip', 'pdf', 'rtf', 'doc',
  'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'bmp',
]);

const BLOCKED_DIRECTORIES = new Set([
  '.git', '.svn', '.hg', '.ssh', '.aws', '.azure', 'node_modules', '.next',
  'dist', 'build', 'coverage', '.cache', 'tmp', 'temp', '__pycache__',
]);
const BLOCKED_FILENAMES = /^(?:\.env(?:\..+)?|\.dev\.vars(?:\..+)?|credentials\.json|service[-_]?account(?:\..+)?\.json|token\.json|secrets?\.json|id_rsa|id_ed25519)$/i;
const BLOCKED_SUFFIXES = /\.(?:pem|key|p12|pfx)$/i;

export type PathRejection = 'invalid' | 'blocked';

export class UnsafePathError extends Error {
  constructor(
    public readonly reason: PathRejection,
    public readonly fileName: string,
  ) {
    super(reason);
  }
}

export function safeRelativePath(value: string) {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (!normalized || normalized.length > 500 || parts.some((part) => !part || part === '.' || part === '..' || part.length > 150)) {
    throw new UnsafePathError('invalid', normalized.split('/').at(-1) ?? '');
  }
  const lowerParts = parts.map((part) => part.toLocaleLowerCase('en-US'));
  const name = lowerParts.at(-1) ?? '';
  if (lowerParts.slice(0, -1).some((part) => BLOCKED_DIRECTORIES.has(part)) || BLOCKED_FILENAMES.test(name) || BLOCKED_SUFFIXES.test(name)) {
    throw new UnsafePathError('blocked', name);
  }
  return normalized;
}

export function extensionOf(relativePath: string) {
  return relativePath.split('.').pop()?.toLocaleLowerCase('en-US') ?? '';
}

export function isAllowedUpload(relativePath: string, sizeBytes: number) {
  return ALLOWED_EXTENSIONS.has(extensionOf(relativePath)) && sizeBytes > 0 && sizeBytes <= MAX_FILE_BYTES;
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

export function contentMatchesExtension(relativePath: string, bytes: Uint8Array) {
  const extension = extensionOf(relativePath);
  if (extension === 'png') return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (extension === 'jpg' || extension === 'jpeg') return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (extension === 'gif') return hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]);
  if (extension === 'bmp') return hasPrefix(bytes, [0x42, 0x4d]);
  if (extension === 'webp') return hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
  if (extension === 'pdf') return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (extension === 'zip' || ['docx', 'xlsx', 'pptx'].includes(extension)) return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]);
  if (['doc', 'xls', 'ppt'].includes(extension)) return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (extension === 'rtf') return hasPrefix(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66]);
  return true;
}
