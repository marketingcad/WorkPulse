/**
 * Does an upload's content match the type the browser declared? The declared type (`File.type`) comes
 * from the file's name on the sender's computer, so a renamed program or web page would otherwise be
 * stored, and later served, as a "PDF" or "PNG" (form validation audit, 20 Nov 2026). This reads the
 * first bytes ("magic numbers") instead. It is a gate on what is stored, not a virus scanner.
 */

const ascii = (bytes: Uint8Array, at: number, text: string) => {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const startsWith = (bytes: Uint8Array, sig: readonly number[]) => sig.length <= bytes.length && sig.every((b, i) => bytes[i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04] as const;
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06] as const;
/** The old Office formats (.doc, .xls, .ppt) are OLE compound files. */
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const isZip = (b: Uint8Array) => startsWith(b, ZIP) || startsWith(b, ZIP_EMPTY);

/** Programs, whatever they are called: Windows (MZ), Linux (ELF), macOS (Mach-O) and scripts (#!). */
function isExecutable(b: Uint8Array): boolean {
  if (ascii(b, 0, 'MZ') || ascii(b, 0, '\x7fELF') || ascii(b, 0, '#!')) return true;
  const machO = [
    [0xfe, 0xed, 0xfa, 0xce],
    [0xfe, 0xed, 0xfa, 0xcf],
    [0xce, 0xfa, 0xed, 0xfe],
    [0xcf, 0xfa, 0xed, 0xfe],
    [0xca, 0xfe, 0xba, 0xbe],
  ];
  return machO.some((sig) => startsWith(b, sig));
}

/** Text: no NUL bytes in the first 8 KB, unless it is UTF-16 (which starts with a byte order mark). */
function isText(b: Uint8Array): boolean {
  if (isExecutable(b)) return false;
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return true;
  const n = Math.min(b.length, 8192);
  for (let i = 0; i < n; i++) if (b[i] === 0) return false;
  return true;
}

const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  // The PDF header may follow a little junk; readers look in the first 1 KB.
  'application/pdf': (b) => {
    const n = Math.min(b.length, 1024);
    for (let i = 0; i + 5 <= n; i++) if (ascii(b, i, '%PDF-')) return true;
    return false;
  },
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'),
  'image/gif': (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'),
  'application/zip': isZip,
  'application/x-zip-compressed': isZip,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': isZip,
  'application/msword': (b) => startsWith(b, OLE),
  'application/vnd.ms-excel': (b) => startsWith(b, OLE),
  'application/vnd.ms-powerpoint': (b) => startsWith(b, OLE),
  'text/plain': isText,
  'text/csv': isText,
};

/**
 * True when `bytes` look like a file of `declaredType`. A type with no check here is refused: callers
 * pass only the types they allow, so a missing entry is a mistake to catch, not a pass.
 */
export function contentMatchesType(bytes: Uint8Array, declaredType: string): boolean {
  const check = CHECKS[declaredType.toLowerCase()];
  return !!check && bytes.length > 0 && check(bytes);
}
