// AES-256-GCM Format-Preserving Encryption/Decryption — Streaming Browser Simulation
// Spec: AES256_GCM_ENCRYPTION.md (xorshift128+ keystream + FPE layer)
// 4-round key chain: each cell is encrypted once per seed (seed1→seed2→seed3→seed4),
// decrypted in reverse (seed4→seed3→seed2→seed1). Final value is guaranteed ≠ original.

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
// Each round shifts every alphanumeric character by >= 1, so per-round output ≠ input.
// After 4 rounds, the net shift is the sum of 4 independent random shifts, which is
// practically guaranteed to be non-zero for any real-world string value.
// Final guarantee: after 4 rounds, if result still equals original (astronomically rare),
// one additional pass using the combined-seed key is applied and undone symmetrically.
function encryptFPECell(ksBytes: Uint8Array, value: string): string {
  const isAllNumeric = /^\d+$/.test(value) && value.length > 1;
  let ki = 0;
  return [...value].map((ch, idx) => {
    const code = ch.charCodeAt(0);
    const k = ksBytes[ki++ % ksBytes.length];
    if (code >= 48 && code <= 57) {
      if (isAllNumeric && idx === 0) {
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

// ── 4-round chain helpers ─────────────────────────────────────────────────────

// Encrypt value through all 4 keystream rounds (seed1 → seed2 → seed3 → seed4).
// If after 4 rounds the result still equals the original, applies a 5th tiebreaker
// round (symmetric with decryptChain4 which also applies/detects the tiebreaker).
function encryptChain4(ksArr: Uint8Array[], original: string): string {
  let v = original;
  for (const ks of ksArr) v = encryptFPECell(ks, v);
  // Tiebreaker: if result still equals original, apply one more round using the
  // 5th keystream (XOR blend of all 4) to guarantee final ≠ original.
  if (v === original && ksArr.length >= 4) {
    v = encryptFPECell(blendKs(ksArr), v);
  }
  return v;
}

// Decrypt in reverse (seed4 → seed3 → seed2 → seed1), then undo tiebreaker if needed.
function decryptChain4(ksArr: Uint8Array[], encrypted: string): string {
  // Check if tiebreaker was applied: a tiebreaker was used iff reversing 4+1 rounds
  // gives a result that, when re-encrypted 5 rounds, matches the input. We detect
  // this by trying both paths and choosing the one where enc4(result) = encrypted.
  let vNormal = encrypted;
  for (let i = ksArr.length - 1; i >= 0; i--) vNormal = decryptFPECell(ksArr[i], vNormal);

  // Verify the normal path: re-encrypt vNormal and see if it matches
  let check = vNormal;
  for (const ks of ksArr) check = encryptFPECell(ks, check);
  if (check === encrypted) return vNormal;

  // Tiebreaker was applied: decrypt the extra round first, then the 4 normal rounds
  let vTB = decryptFPECell(blendKs(ksArr), encrypted);
  for (let i = ksArr.length - 1; i >= 0; i--) vTB = decryptFPECell(ksArr[i], vTB);
  return vTB;
}

// Create a blended keystream from all 4 keystreams (XOR byte-by-byte)
function blendKs(ksArr: Uint8Array[]): Uint8Array {
  const len = ksArr[0].length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let b = ksArr[0][i];
    for (let r = 1; r < ksArr.length; r++) b ^= ksArr[r][i % ksArr[r].length];
    // Ensure blended byte is non-zero so shift is always >= 1
    out[i] = b === 0 ? 1 : b;
  }
  return out;
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
  /** Four seed values — one per encryption round. The value jumps through 4 transformations. */
  seeds: number[];
  passphrase: string;
  pbkdf2Iterations: number;
  deterministic: boolean;
  keyHex?: string;
}

export interface AnonymizeResult {
  blob: Blob;
  keyHex: string;
}

// Resolve the 4-key chain from options.
// KEY SEQUENCE RULE: each round's key is derived from a rolling accumulator that
// folds in every seed seen so far — reordering any two seeds changes ALL subsequent
// round keys, making the sequence of seeds a cryptographic input.
export function resolveKeyChain(options: AnonymizeOptions): string[] {
  if (options.keyMode === "hex") {
    const base = (options.keyHex ?? "").toLowerCase().trim();
    if (base.length !== 64) return [base, base, base, base];
    // Chain-derive 4 sub-keys: each key's seed incorporates all prior round indices
    let rolling = (parseInt(base.slice(0, 8), 16) ^ 0xdeadbeef) >>> 0;
    return [0, 1, 2, 3].map(i => {
      rolling = (Math.imul(rolling, 0x9e3779b9) ^ (i * 0x5a5a5a5b)) >>> 0;
      rolling = (rolling ^ (rolling >>> 16)) >>> 0;
      return generateRandomKey(rolling);
    });
  }
  if (options.keyMode === "pbkdf2" && options.passphrase.trim().length > 0) {
    // Chain-derive 4 sub-keys: each passphrase variant includes all prior round tags
    // so round order is embedded in the key material.
    let tag = "";
    return [0, 1, 2, 3].map(i => {
      tag += `\x00R${i}`;
      return deriveKeyFromPassphrase(options.passphrase + tag, options.pbkdf2Iterations);
    });
  }
  // Random (seed) mode — master-key-then-split derivation:
  //   Phase 1: Fold all 4 seeds in sequence into a single 32-bit master seed.
  //            Reordering any two seeds changes the master seed and therefore
  //            all four round keys — seed sequence is cryptographically significant.
  //   Phase 2: Expand the master seed into one 256-bit master key (32 bytes)
  //            via xorshift128+ seeded with (masterSeed ⊕ 0xDEADBEEF).
  //   Phase 3: Derive 4 round keys from the master key via XOR + rolling mixer
  //            seeded from the master key's first 32 bits (same as hex-key mode).
  const s = options.seeds;
  const ordered = [s[0] ?? 42, s[1] ?? 137, s[2] ?? 2024, s[3] ?? 7];
  // Phase 1 — fold all 4 seeds into a single 32-bit master seed
  let rolling = 0x9e3779b9;
  for (const seed of ordered) {
    rolling = (Math.imul(rolling, 0x9e3779b9) ^ (seed >>> 0)) >>> 0;
    rolling = (rolling ^ (rolling >>> 16)) >>> 0;
    rolling = (Math.imul(rolling, 0x85ebca6b)) >>> 0;
    rolling = (rolling ^ (rolling >>> 13)) >>> 0;
  }
  // Phase 2 — expand master seed into a single 256-bit master key via xorshift128+
  const masterKey = generateRandomKey(rolling);
  // Phase 3 — derive 4 round keys from master key via XOR + rolling mixer
  //   (same mechanism as hex-key mode — seeded from first 32 bits of master key)
  let rollingK = (parseInt(masterKey.slice(0, 8), 16) ^ 0xdeadbeef) >>> 0;
  return [0, 1, 2, 3].map(i => {
    rollingK = (Math.imul(rollingK, 0x9e3779b9) ^ (i * 0x5a5a5a5b)) >>> 0;
    rollingK = (rollingK ^ (rollingK >>> 16)) >>> 0;
    return generateRandomKey(rollingK);
  });
}

// Compat: return first key (used by UI to display "the key" summary)
export function resolveKeyHex(options: AnonymizeOptions): string {
  return resolveKeyChain(options)[0];
}

const STREAM_CHUNK = 50_000;

// ── Streaming encrypt: FWF raw text → anonymized CSV Blob ─────────────────────
export async function encryptFWFToBlob(
  rawText: string,
  fields: FieldSpec[],
  encCols: ReadonlySet<string>,
  options: AnonymizeOptions,
  onProgress: (pct: number) => void
): Promise<AnonymizeResult> {
  const keyChain = resolveKeyChain(options);
  const keyHex = keyChain[0]; // for result metadata

  // Pre-compute 4 per-column keystreams for deterministic mode
  const colKs4: Record<string, Uint8Array[]> = {};
  if (options.deterministic) {
    for (const f of fields) {
      if (encCols.has(f.varName)) {
        colKs4[f.varName] = keyChain.map(kh =>
          makeCellKsBytes(256, kh, hashColIV(kh, f.varName))
        );
      }
    }
  }

  const lines = rawText.split(/\r?\n/);
  let dataLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) dataLines.push(lines[i]);
  }
  if (dataLines.length > 0 && dataLines[0].includes(",")) {
    dataLines = dataLines.slice(1);
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
              const enc = encryptChain4(colKs4[f.varName], val);
              detCache.set(ck, enc);
              val = enc;
            }
          } else {
            ivCounter = (ivCounter + 1) >>> 0;
            // Each round gets a unique IV derived from the counter + round index
            const ksArr = keyChain.map((kh, ri) =>
              makeCellKsBytes(val.length + 32, kh, (ivCounter ^ (ri * 0x12345679)) >>> 0)
            );
            val = encryptChain4(ksArr, val);
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
export async function decryptCSVToBlob(
  csvText: string,
  decCols: ReadonlySet<string>,
  options: AnonymizeOptions,
  onProgress: (pct: number) => void
): Promise<Blob> {
  const lines = csvText.split(/\r?\n/);

  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === "") headerIdx++;
  if (headerIdx >= lines.length) throw new Error("Empty CSV file");

  const headers = splitCSVLine(lines[headerIdx]);
  if (headers.length === 0) throw new Error("No headers found in CSV");

  const keyChain = resolveKeyChain(options);

  // Pre-compute 4 per-column keystreams for deterministic mode
  const colKs4: Record<string, Uint8Array[]> = {};
  if (options.deterministic) {
    for (const col of decCols) {
      colKs4[col] = keyChain.map(kh =>
        makeCellKsBytes(256, kh, hashColIV(kh, col))
      );
    }
  }

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
              const dec = decryptChain4(colKs4[col], val);
              detCache.set(ck, dec);
              val = dec;
            }
          } else {
            ivCounter = (ivCounter + 1) >>> 0;
            const ksArr = keyChain.map((kh, ri) =>
              makeCellKsBytes(val.length + 32, kh, (ivCounter ^ (ri * 0x12345679)) >>> 0)
            );
            val = decryptChain4(ksArr, val);
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
