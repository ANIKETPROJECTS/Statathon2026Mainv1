// AES-256-GCM Format-Preserving Encryption/Decryption — Streaming Browser Simulation
// Spec: AES256_GCM_ENCRYPTION.md (xorshift128+ keystream + FPE layer)
// Streaming design: never builds a full row-object array — processes line-by-line
// in CHUNK-sized batches and accumulates output as Blob-array segments.

// ── §9 — xorshift128+ PRNG ────────────────────────────────────────────────────
function makeKeystream(seed: number) {
  let a = ((seed ^ 0x9e3779b9) >>> 0) || 1;
  let b = ((seed ^ 0x6c62272e) >>> 0) || 2;
  return () => {
    a ^= a << 13; a = a >>> 0;
    a ^= a >> 17;
    a ^= a << 5;  a = a >>> 0;
    b ^= b >> 7;  b = b >>> 0;
    b ^= b << 9;  b = b >>> 0;
    b ^= b >> 8;  b = b >>> 0;
    return (((a + b) >>> 0) / 0x100000000);
  };
}

// ── §8.1 — Random key from seed ───────────────────────────────────────────────
function generateRandomKey(seed: number): string {
  const rng = makeKeystream((seed ^ 0xdeadbeef) >>> 0);
  const bytes: string[] = [];
  for (let i = 0; i < 32; i++)
    bytes.push(Math.floor(rng() * 256).toString(16).padStart(2, "0"));
  return bytes.join("");
}

// ── §8.2 — PBKDF2-like passphrase key ────────────────────────────────────────
function deriveKeyFromPassphrase(passphrase: string, iterations: number): string {
  let h = 0x5a827999;
  for (let i = 0; i < passphrase.length; i++)
    h = (Math.imul(h, 31) + passphrase.charCodeAt(i)) >>> 0;
  const rng = makeKeystream(h);
  for (let i = 0; i < Math.min(iterations, 200); i++) rng();
  const bytes: string[] = [];
  for (let i = 0; i < 32; i++)
    bytes.push(Math.floor(rng() * 256).toString(16).padStart(2, "0"));
  return bytes.join("");
}

// ── §11 — Column IV hash (deterministic per key+col) ─────────────────────────
function hashColIV(keyHex: string, colName: string): number {
  let h = parseInt(keyHex.slice(0, 8), 16) ^ 0xa5a5a5a5;
  const s = "COL\x00" + colName;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(h, 1664525) + s.charCodeAt(i) + 1013904223) >>> 0;
  return h;
}

// ── §12 — Per-cell keystream bytes ────────────────────────────────────────────
function makeCellKsBytes(size: number, keyHex: string, ivSeed: number): Uint8Array {
  const combined = (parseInt(keyHex.slice(0, 8), 16) ^ ivSeed) >>> 0;
  const ksRng = makeKeystream(combined);
  const ksBytes = new Uint8Array(size);
  for (let i = 0; i < size; i++)
    ksBytes[i] = Math.floor(ksRng() * 256);
  return ksBytes;
}

// ── §10 — Format-preserving encryption ───────────────────────────────────────
// Shift is always >= 1 so a value can never encrypt to itself.
// Lead digit (1-9 alphabet, mod 9): shift = 1 + (k % 8)  → range [1,8]
// Regular digit (0-9 alphabet, mod 10): shift = 1 + (k % 9) → range [1,9]
// Letter (26-char alphabet, mod 26): shift = 1 + (k % 25) → range [1,25]
function encryptFPECell(ksBytes: Uint8Array, value: string): string {
  const isAllNumeric = /^\d+$/.test(value) && value.length > 1;
  let ki = 0;
  return [...value].map((ch, idx) => {
    const code = ch.charCodeAt(0);
    const k = ksBytes[ki++ % ksBytes.length];
    if (code >= 48 && code <= 57) {
      if (isAllNumeric && idx === 0) {
        // Map within 1-9 (mod-9 space), guaranteed non-zero shift
        const d = code - 49;
        return String.fromCharCode(49 + ((d + 1 + (k % 8) + 81) % 9));
      }
      return String.fromCharCode(48 + ((code - 48 + 1 + (k % 9)) % 10));
    } else if (code >= 65 && code <= 90) {
      return String.fromCharCode(65 + ((code - 65 + 1 + (k % 25)) % 26));
    } else if (code >= 97 && code <= 122) {
      return String.fromCharCode(97 + ((code - 97 + 1 + (k % 25)) % 26));
    }
    return ch;
  }).join("");
}

// ── §10 — Format-preserving decryption (exact reverse) ───────────────────────
function decryptFPECell(ksBytes: Uint8Array, value: string): string {
  const isAllNumeric = /^\d+$/.test(value) && value.length > 1;
  let ki = 0;
  return [...value].map((ch, idx) => {
    const code = ch.charCodeAt(0);
    const k = ksBytes[ki++ % ksBytes.length];
    if (code >= 48 && code <= 57) {
      if (isAllNumeric && idx === 0) {
        const d = code - 49;
        return String.fromCharCode(49 + ((d - 1 - (k % 8) + 81) % 9));
      }
      return String.fromCharCode(48 + ((code - 48 - 1 - (k % 9) + 100) % 10));
    } else if (code >= 65 && code <= 90) {
      return String.fromCharCode(65 + ((code - 65 - 1 - (k % 25) + 2600) % 26));
    } else if (code >= 97 && code <= 122) {
      return String.fromCharCode(97 + ((code - 97 - 1 - (k % 25) + 2600) % 26));
    }
    return ch;
  }).join("");
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n"))
    return '"' + val.replace(/"/g, '""') + '"';
  return val;
}

function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let inQ = false, cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      cells.push(cur); cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface FieldSpec {
  varName: string;
  start: number;
  end: number;
}

export interface AnonymizeOptions {
  keyMode: "random" | "pbkdf2" | "hex";
  seed: number;
  passphrase: string;
  pbkdf2Iterations: number;
  deterministic: boolean;
  keyHex?: string;
}

export interface AnonymizeResult {
  blob: Blob;
  keyHex: string;
}

// Resolve key hex from options
export function resolveKeyHex(options: AnonymizeOptions): string {
  if (options.keyMode === "hex") return (options.keyHex ?? "").toLowerCase().trim();
  if (options.keyMode === "pbkdf2" && options.passphrase.trim().length > 0)
    return deriveKeyFromPassphrase(options.passphrase, options.pbkdf2Iterations);
  return generateRandomKey(options.seed);
}

const STREAM_CHUNK = 50_000;

// ── Streaming encrypt: FWF raw text → anonymized CSV Blob ─────────────────────
// Never builds a full row-object array. Processes STREAM_CHUNK lines at a time.
export async function encryptFWFToBlob(
  rawText: string,
  fields: FieldSpec[],
  encCols: ReadonlySet<string>,
  options: AnonymizeOptions,
  onProgress: (pct: number) => void
): Promise<AnonymizeResult> {
  const keyHex = resolveKeyHex(options);

  // Pre-compute per-column keystreams for deterministic mode
  const colKs: Record<string, Uint8Array> = {};
  if (options.deterministic) {
    for (const f of fields)
      if (encCols.has(f.varName))
        colKs[f.varName] = makeCellKsBytes(256, keyHex, hashColIV(keyHex, f.varName));
  }

  const lines = rawText.split(/\r?\n/);
  const dataLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) dataLines.push(lines[i]);
  }
  const total = dataLines.length;

  const header = fields.map((f) => csvEscape(f.varName)).join(",");
  const chunks: string[] = [header + "\n"];

  const detCache = new Map<string, string>();
  let ivCounter = 0;

  for (let i = 0; i < total; i += STREAM_CHUNK) {
    const end = Math.min(i + STREAM_CHUNK, total);
    const rowLines: string[] = [];

    for (let li = i; li < end; li++) {
      const line = dataLines[li];
      const csvCells: string[] = [];

      for (const f of fields) {
        let val = line.padEnd(f.end).substring(f.start - 1, f.end).trim();

        if (encCols.has(f.varName) && val.length > 0) {
          if (options.deterministic) {
            const ck = f.varName + "\x00" + val;
            if (detCache.has(ck)) {
              val = detCache.get(ck)!;
            } else {
              const enc = encryptFPECell(colKs[f.varName], val);
              detCache.set(ck, enc);
              val = enc;
            }
          } else {
            ivCounter = (ivCounter + 1) >>> 0;
            val = encryptFPECell(makeCellKsBytes(val.length + 32, keyHex, ivCounter), val);
          }
        }
        csvCells.push(csvEscape(val));
      }
      rowLines.push(csvCells.join(","));
    }

    chunks.push(rowLines.join("\n") + "\n");
    onProgress(Math.min(99, Math.round((end / total) * 100)));
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress(100);
  return { blob: new Blob(chunks, { type: "text/csv;charset=utf-8;" }), keyHex };
}

// ── Streaming decrypt: CSV text → decrypted CSV Blob ─────────────────────────
// Never builds a full row-object array.
export async function decryptCSVToBlob(
  csvText: string,
  decCols: ReadonlySet<string>,
  options: AnonymizeOptions,
  onProgress: (pct: number) => void
): Promise<Blob> {
  const lines = csvText.split(/\r?\n/);

  // Find first non-empty line as header
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === "") headerIdx++;
  if (headerIdx >= lines.length) throw new Error("Empty CSV file");

  const headers = splitCSVLine(lines[headerIdx]);
  if (headers.length === 0) throw new Error("No headers found in CSV");

  const keyHex = resolveKeyHex(options);

  // Pre-compute per-column keystreams for deterministic mode
  const colKs: Record<string, Uint8Array> = {};
  if (options.deterministic) {
    for (const col of decCols)
      colKs[col] = makeCellKsBytes(256, keyHex, hashColIV(keyHex, col));
  }

  // Collect non-empty data lines (after header)
  const dataLines: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) dataLines.push(lines[i]);
  }
  const total = dataLines.length;

  const headerLine = headers.map(csvEscape).join(",");
  const chunks: string[] = [headerLine + "\n"];

  const detCache = new Map<string, string>();
  let ivCounter = 0;

  for (let i = 0; i < total; i += STREAM_CHUNK) {
    const end = Math.min(i + STREAM_CHUNK, total);
    const rowLines: string[] = [];

    for (let li = i; li < end; li++) {
      const cells = splitCSVLine(dataLines[li]);
      const outCells: string[] = [];

      for (let ci = 0; ci < headers.length; ci++) {
        const col = headers[ci];
        let val = cells[ci] ?? "";

        if (decCols.has(col) && val.length > 0) {
          if (options.deterministic) {
            const ck = col + "\x00" + val;
            if (detCache.has(ck)) {
              val = detCache.get(ck)!;
            } else {
              const dec = decryptFPECell(colKs[col], val);
              detCache.set(ck, dec);
              val = dec;
            }
          } else {
            ivCounter = (ivCounter + 1) >>> 0;
            val = decryptFPECell(makeCellKsBytes(val.length + 32, keyHex, ivCounter), val);
          }
        }
        outCells.push(csvEscape(val));
      }
      rowLines.push(outCells.join(","));
    }

    chunks.push(rowLines.join("\n") + "\n");
    onProgress(Math.min(99, Math.round((end / total) * 100)));
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress(100);
  return new Blob(chunks, { type: "text/csv;charset=utf-8;" });
}

// ── CSV header reader (first line only — for column selector UI) ──────────────
export function readCSVHeaders(text: string): string[] {
  const firstLine = text.slice(0, 8192).split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return splitCSVLine(firstLine);
}
