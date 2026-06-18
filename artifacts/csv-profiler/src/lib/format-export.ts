import Papa from "papaparse";
import type { FieldDef } from "./fwf-parser";

// ── Shared helpers ────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "txt" | "dta" | "sav" | "xpt";

export interface FormatMeta {
  id: ExportFormat;
  label: string;
  ext: string;
  description: string;
}

export const EXPORT_FORMATS: FormatMeta[] = [
  { id: "csv",  label: "CSV",         ext: ".csv", description: "Comma-separated values" },
  { id: "txt",  label: "TXT",         ext: ".txt", description: "Original fixed-width format with anonymized data" },
  { id: "dta",  label: "Stata",       ext: ".dta", description: "Stata dataset (v115)" },
  { id: "sav",  label: "SPSS",        ext: ".sav", description: "SPSS Statistics data file" },
  { id: "xpt",  label: "SAS XPORT",   ext: ".xpt", description: "SAS transport format (v5)" },
];

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function parseCsvBlob(blob: Blob): Promise<{ headers: string[]; rows: string[][] }> {
  const text = await blob.text();
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const data = result.data as string[][];
  if (data.length === 0) return { headers: [], rows: [] };
  return { headers: data[0], rows: data.slice(1) };
}

// Truncate / right-pad a string to exactly `len` bytes in a Uint8Array (ASCII)
function encodeFixed(enc: TextEncoder, s: string, len: number, padChar = 0): Uint8Array {
  const arr = new Uint8Array(len);
  if (padChar !== 0) arr.fill(padChar);
  const b = enc.encode(s);
  arr.set(b.subarray(0, Math.min(b.length, len)));
  return arr;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export function exportAsCSV(csvBlob: Blob, baseName: string): void {
  triggerDownload(csvBlob, `${baseName}_anonymized.csv`);
}

// ── TXT (Fixed-Width) ─────────────────────────────────────────────────────────

export async function exportAsTXT(
  csvBlob: Blob,
  fields: FieldDef[],
  baseName: string
): Promise<void> {
  const { headers, rows } = await parseCsvBlob(csvBlob);
  const recordLen = Math.max(...fields.map((f) => f.end));

  const lines: string[] = rows.map((row) => {
    const record = new Uint8Array(recordLen).fill(0x20); // fill with spaces
    for (const field of fields) {
      const ci = headers.indexOf(field.varName);
      const val = ci >= 0 ? (row[ci] ?? "") : "";
      for (let i = 0; i < field.length; i++) {
        const ch = i < val.length ? val.charCodeAt(i) : 0x20;
        record[field.start - 1 + i] = ch & 0xff;
      }
    }
    return String.fromCharCode(...record);
  });

  const blob = new Blob([lines.join("\r\n")], { type: "text/plain" });
  triggerDownload(blob, `${baseName}_anonymized.txt`);
}

// ── Stata DTA v115 ────────────────────────────────────────────────────────────
// Spec: https://www.stata.com/help.cgi?dta_115

export async function exportAsStata(
  csvBlob: Blob,
  fields: FieldDef[],
  baseName: string
): Promise<void> {
  const { headers, rows } = await parseCsvBlob(csvBlob);
  const enc = new TextEncoder();
  const nvar = fields.length;
  const nobs = rows.length;
  // Stata str type: 1-244. Values above 244 are capped.
  const strLen = fields.map((f) => Math.min(Math.max(f.length, 1), 244));
  const recordSize = strLen.reduce((a, b) => a + b, 0);

  // Pre-calculate buffer size
  const headerBytes = 1 + 1 + 1 + 1 + 2 + 4 + 81 + 18; // 109
  const typlistBytes = nvar;
  const varlistBytes = nvar * 33;
  const srtlistBytes = (nvar + 1) * 2;
  const fmtlistBytes = nvar * 49;
  const lbllistBytes = nvar * 33;
  const vlblistBytes = nvar * 81;
  const expansionBytes = 3; // terminator: type(1)+len(2)=0,0
  const dataBytes = recordSize * nobs;
  const total =
    headerBytes +
    typlistBytes +
    varlistBytes +
    srtlistBytes +
    fmtlistBytes +
    lbllistBytes +
    vlblistBytes +
    expansionBytes +
    dataBytes;

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  let off = 0;

  const wb = (v: number) => { buf[off++] = v; };
  const wi16 = (v: number) => { dv.setInt16(off, v, true); off += 2; };
  const wi32 = (v: number) => { dv.setInt32(off, v, true); off += 4; };
  const wfixed = (s: string, len: number, pad = 0) => {
    const chunk = encodeFixed(enc, s, len, pad);
    buf.set(chunk, off);
    off += len;
  };

  // ── Header
  wb(115);   // ds_format
  wb(0x01);  // byteorder: LOHI (little-endian)
  wb(1);     // filetype
  wb(0);     // unused
  wi16(nvar);
  wi32(nobs);
  wfixed("", 81);  // data_label (blank)

  const now = new Date();
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const ts =
    String(now.getDate()).padStart(2, " ") + " " +
    MO[now.getMonth()] + " " +
    now.getFullYear() + " " +
    String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0");
  wfixed(ts, 18);

  // ── Descriptors
  for (const l of strLen) wb(l);             // typlist
  for (const f of fields) {
    const nm = f.varName.replace(/[^A-Za-z0-9_]/g, "_").substring(0, 32);
    wfixed(nm, 33);
  }                                           // varlist
  for (let i = 0; i <= nvar; i++) wi16(0);   // srtlist (all unsorted)
  for (const l of strLen) wfixed(`%-${l}s`, 49);  // fmtlist
  for (let i = 0; i < nvar; i++) { buf.fill(0, off, off + 33); off += 33; } // lbllist (empty)

  // ── Variable labels (fullName || varName, 81 bytes each)
  for (const f of fields) wfixed(f.fullName || f.varName, 81);

  // ── Expansion fields terminator
  wb(0); wi16(0); // type=0, len=0

  // ── Data
  const colIdx = new Map(fields.map((f) => [f.varName, headers.indexOf(f.varName)]));
  for (const row of rows) {
    for (let v = 0; v < nvar; v++) {
      const ci = colIdx.get(fields[v].varName) ?? -1;
      const val = ci >= 0 ? (row[ci] ?? "") : "";
      const l = strLen[v];
      const chunk = encodeFixed(enc, val, l);
      buf.set(chunk, off);
      off += l;
    }
  }

  triggerDownload(
    new Blob([buf], { type: "application/octet-stream" }),
    `${baseName}_anonymized.dta`
  );
}

// ── SPSS SAV (uncompressed, string variables only) ────────────────────────────
// Spec: https://www.gnu.org/software/pspp/pspp-dev/html_node/System-File-Format.html

export async function exportAsSPSS(
  csvBlob: Blob,
  fields: FieldDef[],
  baseName: string
): Promise<void> {
  const { headers, rows } = await parseCsvBlob(csvBlob);
  const enc = new TextEncoder();

  // SPSS stores strings in 8-byte "segments". Max string type value = 255.
  // For strings > 255 we'd need very-long-string extensions — cap at 255 for simplicity.
  const varLen = fields.map((f) => Math.min(Math.max(f.length, 1), 255));
  // Number of 8-byte segments per variable
  const segments = varLen.map((l) => Math.ceil(l / 8));
  const nominalCaseSize = segments.reduce((a, b) => a + b, 0);

  // Build variable records
  type VarRec = { type: number; name: string; label: string; segIdx: number };
  const varRecs: VarRec[] = [];
  for (let v = 0; v < fields.length; v++) {
    const f = fields[v];
    const segs = segments[v];
    const name = (f.varName.replace(/[^A-Za-z0-9_]/g, "_") + "        ").substring(0, 8).toUpperCase();
    for (let s = 0; s < segs; s++) {
      varRecs.push({
        type: s === 0 ? varLen[v] : -1,  // -1 = continuation
        name: s === 0 ? name : `        `,
        label: s === 0 ? (f.fullName || f.varName) : "",
        segIdx: s,
      });
    }
  }

  // Helper to build one variable record (32 bytes + optional label bytes)
  function buildVarRecord(vr: VarRec): Uint8Array {
    const hasLabel = vr.segIdx === 0 && vr.label.length > 0;
    const labelBytes = hasLabel
      ? Math.ceil(Math.min(vr.label.length, 252) / 4) * 4
      : 0;
    const recSize = 32 + (hasLabel ? 4 + labelBytes : 0);
    const buf = new Uint8Array(recSize);
    const dv = new DataView(buf.buffer);
    let o = 0;
    dv.setInt32(o, 2, true); o += 4;           // rec_type = 2
    dv.setInt32(o, vr.type === -1 ? -1 : vr.type, true); o += 4;  // type
    dv.setInt32(o, hasLabel ? 1 : 0, true); o += 4;    // has_var_label
    dv.setInt32(o, 0, true); o += 4;           // n_missing_values
    // print format: A format = type 1, width = varLen, decimals = 0
    const fmtWidth = vr.type > 0 ? vr.type : 1;
    dv.setInt32(o, (1 << 16) | (fmtWidth << 8) | 0, true); o += 4;
    dv.setInt32(o, (1 << 16) | (fmtWidth << 8) | 0, true); o += 4;  // write
    buf.set(encodeFixed(enc, vr.name, 8, 0x20), o); o += 8;  // name

    if (hasLabel) {
      const lb = enc.encode(vr.label.substring(0, 252));
      dv.setInt32(o, lb.length, true); o += 4;
      buf.set(encodeFixed(enc, vr.label, labelBytes, 0x20), o); o += labelBytes;
    }
    return buf;
  }

  // Measure total size
  const varRecBuffers = varRecs.map(buildVarRecord);
  const varRecSize = varRecBuffers.reduce((a, b) => a + b.byteLength, 0);

  // File header: 176 bytes
  // Rec type 7 subtype 3 (machine int info): 32 + 32 bytes = 64
  // Rec type 7 subtype 4 (machine float info): 32 + 24 bytes = 56
  // Rec type 999 terminator: 8 bytes
  // Data: nominalCaseSize * 8 * nobs bytes
  const headerSize = 176;
  const info3Size = 32 + 32;
  const info4Size = 32 + 24;
  const terminatorSize = 8;
  const dataSize = nominalCaseSize * 8 * rows.length;
  const totalSize = headerSize + varRecSize + info3Size + info4Size + terminatorSize + dataSize;

  const buf = new Uint8Array(totalSize);
  const dv = new DataView(buf.buffer);
  let off = 0;

  const wbytes = (bytes: Uint8Array) => { buf.set(bytes, off); off += bytes.length; };
  const wfixed = (s: string, len: number, pad = 0x20) => {
    wbytes(encodeFixed(enc, s, len, pad));
  };
  const wi32 = (v: number) => { dv.setInt32(off, v, true); off += 4; };
  const wf64 = (v: number) => { dv.setFloat64(off, v, true); off += 8; };

  // ── File header record (176 bytes)
  wfixed("$FL2", 4, 0x20);    // rec_type
  wfixed("@(#) SPSS DATA FILE - Anonymized Export", 60, 0x20);  // prod_name
  wi32(2);                     // layout_code
  wi32(nominalCaseSize);       // nominal_case_size
  wi32(0);                     // compress (0 = uncompressed)
  wi32(0);                     // weight_index
  wi32(rows.length);           // ncases
  wf64(100.0);                 // bias
  const now = new Date();
  const MO2 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateStr = String(now.getDate()).padStart(2,"0") + " " + MO2[now.getMonth()] + " " + String(now.getFullYear()).slice(-2);
  const timeStr = String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0") + ":" + String(now.getSeconds()).padStart(2,"0");
  wfixed(dateStr, 9, 0x20);
  wfixed(timeStr, 8, 0x20);
  wfixed("Anonymized data export", 64, 0x20);
  wfixed("   ", 3, 0x20);      // padding

  // ── Variable records
  for (const vb of varRecBuffers) wbytes(vb);

  // ── Record type 7, subtype 3: machine integer info (8 ints)
  wi32(7); wi32(3); wi32(4); wi32(8);  // rec_type, subtype, elem_size, n_elem
  wi32(1);   // version major
  wi32(0);   // version minor
  wi32(0);   // version revision
  wi32(-1);  // machine code
  wi32(1);   // floating-point rep (IEEE 754)
  wi32(0);   // compression code (not used)
  wi32(2);   // endianness (1=big, 2=little)
  wi32(1252);// char code (Windows-1252)

  // ── Record type 7, subtype 4: machine floating-point info (3 doubles)
  wi32(7); wi32(4); wi32(8); wi32(3);  // rec_type, subtype, elem_size, n_elem
  wf64(-99);        // sysmis
  wf64(Number.MAX_VALUE);  // highest
  wf64(-Number.MAX_VALUE); // lowest

  // ── Dictionary terminator
  wi32(999); wi32(0);

  // ── Data (raw, 8-byte padded strings)
  const colIdx = new Map(fields.map((f) => [f.varName, headers.indexOf(f.varName)]));
  for (const row of rows) {
    for (let v = 0; v < fields.length; v++) {
      const ci = colIdx.get(fields[v].varName) ?? -1;
      const val = ci >= 0 ? (row[ci] ?? "") : "";
      const totalLen = segments[v] * 8;
      wbytes(encodeFixed(enc, val, totalLen, 0x20));
    }
  }

  triggerDownload(
    new Blob([buf], { type: "application/octet-stream" }),
    `${baseName}_anonymized.sav`
  );
}

// ── SAS XPORT v5 (.xpt) ───────────────────────────────────────────────────────
// Spec: https://support.sas.com/techsup/technote/ts140.pdf

export async function exportAsSAS(
  csvBlob: Blob,
  fields: FieldDef[],
  baseName: string
): Promise<void> {
  const { headers, rows } = await parseCsvBlob(csvBlob);
  const enc = new TextEncoder();
  const nvar = fields.length;
  // SAS character variable max length: 200 in XPORT v5
  const varLen = fields.map((f) => Math.min(Math.max(f.length, 1), 200));
  const recordLen = varLen.reduce((a, b) => a + b, 0);

  function pad80(s: string): Uint8Array {
    return encodeFixed(enc, s, 80, 0x20);
  }

  function sasDate(): string {
    const now = new Date();
    const MO = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${dd}${MO[now.getMonth()]}${yy}:${hh}:${mm}:${ss}`;
  }

  const dt = sasDate(); // e.g. "18JUN26:12:00:00"
  const dsName = baseName.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase().substring(0, 8);
  const nNamestrRecs = Math.ceil((nvar * 140) / 80);
  const nNamestrPad = nNamestrRecs * 80 - nvar * 140;

  // Data records: each obs is `recordLen` bytes, padded to multiples of 80
  const obsRecLen = Math.ceil(recordLen / 80) * 80;

  // Total size
  const libHdr = 3 * 80;       // 3 library header records
  const memberHdr = 4 * 80;    // 4 member header records
  const namestrHdr = 80;
  const namestrData = nNamestrRecs * 80;
  const obsHdr = 80;
  const obsData = obsRecLen * rows.length;
  const total = libHdr + memberHdr + namestrHdr + namestrData + obsHdr + obsData;

  const buf = new Uint8Array(total);
  let off = 0;
  const wb = (bytes: Uint8Array) => { buf.set(bytes, off); off += bytes.length; };

  // ── Library headers (3 × 80 bytes)
  wb(pad80("HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000  "));
  wb(pad80(`SAS     SAS     SASLIB  6.06    bsd4.2                          ${dt}`));
  wb(pad80(`${dt}                                                                `));

  // ── Member headers (4 × 80 bytes)
  wb(pad80("HEADER RECORD*******MEMBER  HEADER RECORD!!!!!!!000000000000000001600000000140  "));
  wb(pad80("HEADER RECORD*******DSCRPTR HEADER RECORD!!!!!!!000000000000000000000000000000  "));
  wb(pad80(
    ("SAS     " + dsName.padEnd(8) + "SASDATA 6.06    bsd4.2                          " + dt)
      .substring(0, 80).padEnd(80)
  ));
  wb(pad80((dt + "        " + "Anonymized Export".substring(0, 40).padEnd(40) + "                       ").substring(0, 80).padEnd(80)));

  // ── NAMESTR header
  wb(pad80("HEADER RECORD*******NAMESTR HEADER RECORD!!!!!!!000000000000000000000000000000  "));

  // ── NAMESTR records (140 bytes each variable, no padding between)
  const namestrBuf = new Uint8Array(nvar * 140);
  const ndv = new DataView(namestrBuf.buffer);
  for (let v = 0; v < nvar; v++) {
    const base = v * 140;
    const f = fields[v];
    const nm = (f.varName.replace(/[^A-Za-z0-9_]/g, "_") + "        ").substring(0, 8).toUpperCase();
    const lbl = ((f.fullName || f.varName) + " ".repeat(40)).substring(0, 40);
    const fmt = ("$" + varLen[v]).padEnd(8).substring(0, 8).toUpperCase();
    const infmt = fmt;

    ndv.setInt16(base + 0, 2, false);    // ntype: 2 = character (big-endian for XPORT)
    ndv.setInt16(base + 2, 0, false);    // nhfun
    ndv.setInt16(base + 4, varLen[v], false);  // nlng: variable length
    ndv.setInt16(base + 6, v, false);    // nvar0: variable number
    namestrBuf.set(encodeFixed(enc, nm, 8, 0x20), base + 8);    // nname
    namestrBuf.set(encodeFixed(enc, lbl, 40, 0x20), base + 16); // nlabel
    namestrBuf.set(encodeFixed(enc, fmt, 8, 0x20), base + 56);  // nform
    ndv.setInt16(base + 64, varLen[v], false); // nfl
    ndv.setInt16(base + 66, 0, false);   // nfd
    ndv.setInt16(base + 68, 0, false);   // nfj (left)
    namestrBuf.set(encodeFixed(enc, infmt, 8, 0x20), base + 72); // niform
    ndv.setInt16(base + 80, varLen[v], false); // nifl
    ndv.setInt16(base + 82, 0, false);   // nifd
    // npos: byte position in obs record
    const npos = varLen.slice(0, v).reduce((a, b) => a + b, 0);
    ndv.setInt32(base + 84, npos, false); // npos (big-endian)
    // rest[52] left as zeros
  }
  buf.set(namestrBuf, off);
  off += namestrBuf.byteLength;
  // Pad to 80-byte boundary
  if (nNamestrPad > 0) {
    buf.fill(0x20, off, off + nNamestrPad);
    off += nNamestrPad;
  }

  // ── OBS header
  wb(pad80("HEADER RECORD*******OBS     HEADER RECORD!!!!!!!000000000000000000000000000000  "));

  // ── Data records
  const colIdxMap = new Map(fields.map((f) => [f.varName, headers.indexOf(f.varName)]));
  for (const row of rows) {
    const recBuf = new Uint8Array(obsRecLen).fill(0x20);
    let roff = 0;
    for (let v = 0; v < nvar; v++) {
      const ci = colIdxMap.get(fields[v].varName) ?? -1;
      const val = ci >= 0 ? (row[ci] ?? "") : "";
      const chunk = encodeFixed(enc, val, varLen[v], 0x20);
      recBuf.set(chunk, roff);
      roff += varLen[v];
    }
    buf.set(recBuf, off);
    off += obsRecLen;
  }

  triggerDownload(
    new Blob([buf], { type: "application/octet-stream" }),
    `${baseName}_anonymized.xpt`
  );
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function exportAs(
  format: ExportFormat,
  csvBlob: Blob,
  fields: FieldDef[],
  baseName: string
): Promise<void> {
  switch (format) {
    case "csv": exportAsCSV(csvBlob, baseName); break;
    case "txt": await exportAsTXT(csvBlob, fields, baseName); break;
    case "dta": await exportAsStata(csvBlob, fields, baseName); break;
    case "sav": await exportAsSPSS(csvBlob, fields, baseName); break;
    case "xpt": await exportAsSAS(csvBlob, fields, baseName); break;
  }
}
