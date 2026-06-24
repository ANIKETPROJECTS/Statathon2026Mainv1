import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ArrowRight, RotateCcw, Download } from "lucide-react";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Algorithm (matches anonymize.ts exactly — used to produce live values)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

function generateRandomKey(seed: number): string {
  const rng = makeKeystream((seed ^ 0xdeadbeef) >>> 0);
  return Array.from({ length: 32 }, () => Math.floor(rng() * 256).toString(16).padStart(2, "0")).join("");
}

function hashColIV(keyHex: string, colName: string): number {
  let h = parseInt(keyHex.slice(0, 8), 16) ^ 0xa5a5a5a5;
  const s = "COL\x00" + colName;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(h, 1664525) + s.charCodeAt(i) + 1013904223) >>> 0;
  return h;
}

function makeCellKsBytes(size: number, keyHex: string, ivSeed: number): Uint8Array {
  const combined = (parseInt(keyHex.slice(0, 8), 16) ^ ivSeed) >>> 0;
  const ksRng = makeKeystream(combined);
  return Uint8Array.from({ length: size }, () => Math.floor(ksRng() * 256));
}

function fpeEncryptChar(ch: string, k: number, idx: number, isAllNumeric: boolean): string {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) {
    if (isAllNumeric && idx === 0) return String.fromCharCode(49 + ((code - 49 + 1 + (k % 8) + 81) % 9));
    return String.fromCharCode(48 + ((code - 48 + 1 + (k % 9)) % 10));
  }
  if (code >= 65 && code <= 90) return String.fromCharCode(65 + ((code - 65 + 1 + (k % 25)) % 26));
  if (code >= 97 && code <= 122) return String.fromCharCode(97 + ((code - 97 + 1 + (k % 25)) % 26));
  return ch;
}

function fpeDecryptChar(ch: string, k: number, idx: number, isAllNumeric: boolean): string {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) {
    if (isAllNumeric && idx === 0) return String.fromCharCode(49 + ((code - 49 - 1 - (k % 8) + 81) % 9));
    return String.fromCharCode(48 + ((code - 48 - 1 - (k % 9) + 100) % 10));
  }
  if (code >= 65 && code <= 90) return String.fromCharCode(65 + ((code - 65 - 1 - (k % 25) + 2600) % 26));
  if (code >= 97 && code <= 122) return String.fromCharCode(97 + ((code - 97 - 1 - (k % 25) + 2600) % 26));
  return ch;
}

function runRound(value: string, ks: Uint8Array, mode: "enc" | "dec"): { output: string; charShifts: CharShift[] } {
  const isAllNumeric = /^\d+$/.test(value) && value.length > 1;
  const chars = [...value];
  let ki = 0;
  const charShifts: CharShift[] = [];
  let output = "";
  for (let idx = 0; idx < chars.length; idx++) {
    const ch = chars[idx];
    const k = ks[ki++ % ks.length];
    const result = mode === "enc" ? fpeEncryptChar(ch, k, idx, isAllNumeric) : fpeDecryptChar(ch, k, idx, isAllNumeric);
    output += result;
    charShifts.push({ from: ch, to: result, k, changed: ch !== result });
  }
  return { output, charShifts };
}

interface CharShift { from: string; to: string; k: number; changed: boolean; }

interface KeyDerivStep {
  seedIdx: number;
  seed: number;
  rollingBefore: number;
  afterMulXor: number;
  afterMix1: number;
  afterMul2: number;
  afterMix2: number;
  rollingAfter: number;
  key: string;
}

interface Trace {
  keys: string[];
  colIVs: number[];
  encStages: string[];
  encShifts: CharShift[][];
  decStages: string[];
  decShifts: CharShift[][];
  finalEncrypted: string;
  finalDecrypted: string;
  keyDerivSteps: KeyDerivStep[];
}

function computeTrace(seeds: number[], colName: string, rawValue: string): Trace {
  const value = rawValue || "A";
  let rolling = 0x9e3779b9;
  const keys: string[] = [];
  const keyDerivSteps: KeyDerivStep[] = [];
  for (let i = 0; i < 4; i++) {
    const seed = seeds[i] ?? 0;
    const rollingBefore = rolling;
    const afterMulXor = (Math.imul(rolling, 0x9e3779b9) ^ (seed >>> 0)) >>> 0;
    const afterMix1 = (afterMulXor ^ (afterMulXor >>> 16)) >>> 0;
    const afterMul2 = Math.imul(afterMix1, 0x85ebca6b) >>> 0;
    const afterMix2 = (afterMul2 ^ (afterMul2 >>> 13)) >>> 0;
    rolling = afterMix2;
    const key = generateRandomKey(rolling);
    keys.push(key);
    keyDerivSteps.push({ seedIdx: i, seed, rollingBefore, afterMulXor, afterMix1, afterMul2, afterMix2, rollingAfter: rolling, key });
  }

  const colIVs = keys.map(k => hashColIV(k, colName));
  const ksArr = keys.map((k, i) => makeCellKsBytes(value.length + 32, k, colIVs[i]));

  const encStages: string[] = [value];
  const encShifts: CharShift[][] = [];
  let cur = value;
  for (let i = 0; i < 4; i++) {
    const { output, charShifts } = runRound(cur, ksArr[i], "enc");
    encStages.push(output);
    encShifts.push(charShifts);
    cur = output;
  }

  const finalEncrypted = cur;

  const decStages: string[] = [finalEncrypted];
  const decShifts: CharShift[][] = [];
  let dec = finalEncrypted;
  for (let i = 3; i >= 0; i--) {
    const { output, charShifts } = runRound(dec, ksArr[i], "dec");
    decStages.push(output);
    decShifts.push(charShifts);
    dec = output;
  }

  return { keys, colIVs, encStages, encShifts, decStages, decShifts, finalEncrypted, finalDecrypted: dec, keyDerivSteps };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PDF export — opens a styled print window
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function hex8(n: number) { return "0x" + n.toString(16).toUpperCase().padStart(8, "0"); }

function charTypeName(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return "Digit";
  if (c >= 65 && c <= 90) return "Uppercase";
  if (c >= 97 && c <= 122) return "Lowercase";
  return "Symbol";
}

function exportTracePDF(trace: Trace, seeds: number[], colName: string, cellValue: string) {
  const now = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const value = cellValue || "A";

  function charTable(shifts: CharShift[], stageLabel: string, outputLabel: string, phase: "enc" | "dec"): string {
    const rows = shifts.map((s, i) => {
      const spinAmt = s.changed
        ? (s.from.match(/[a-zA-Z]/) ? `+${s.k % 25}` : `+${s.k % 9}`)
        : "—";
      const bg = i % 2 === 0 ? "#fff" : "#f8f9fa";
      const resultColor = phase === "enc" ? "#16a34a" : "#2563eb";
      return `<tr style="background:${bg}">
        <td>${i + 1}</td>
        <td style="font-family:monospace;font-weight:bold;color:#2563eb">'${s.from}' (${s.from.charCodeAt(0)})</td>
        <td>${charTypeName(s.from)}</td>
        <td style="font-family:monospace;font-weight:bold;color:#b45309">${s.k}</td>
        <td style="font-family:monospace;color:#7c3aed">${spinAmt}</td>
        <td style="font-family:monospace;font-weight:bold;color:${resultColor}">'${s.to}' (${s.to.charCodeAt(0)})</td>
        <td>${s.changed ? (phase === "enc" ? "shifted" : "un-shifted") : "unchanged"}</td>
      </tr>`;
    }).join("");
    return `
      <div class="section-label">${stageLabel}</div>
      <div class="value-row">
        <span class="tag blue">${phase === "enc" ? "Input" : "Encrypted input"}</span>
        <code>${shifts.map(s => s.from).join("")}</code>
        <span style="margin:0 8px;color:#94a3b8">→</span>
        <span class="tag ${phase === "enc" ? "green" : "blue-dark"}">${outputLabel}</span>
        <code>${shifts.map(s => s.to).join("")}</code>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Input char</th><th>Type</th><th>Key byte (k)</th>
          <th>Spin amount</th><th>Output char</th><th>Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const keyDerivRows = trace.keyDerivSteps.map((s, i) => {
    const bg = i % 2 === 0 ? "#fff" : "#f8f9fa";
    return `<tr style="background:${bg}">
      <td>${i + 1}</td>
      <td style="font-family:monospace;font-weight:bold">${s.seed}</td>
      <td style="font-family:monospace">${hex8(s.rollingBefore)}</td>
      <td style="font-family:monospace">${hex8(s.afterMulXor)}</td>
      <td style="font-family:monospace">${hex8(s.afterMix1)}</td>
      <td style="font-family:monospace">${hex8(s.afterMul2)}</td>
      <td style="font-family:monospace">${hex8(s.afterMix2)}</td>
      <td style="font-family:monospace;word-break:break-all;font-size:9px">${s.key}</td>
    </tr>`;
  }).join("");

  const encRoundSections = trace.encShifts.map((shifts, i) => `
    <div class="phase-card">
      <div class="round-header green">Round ${i + 1} of 4 — Key ${i + 1}</div>
      <div class="key-display"><strong>Key:</strong> <code>${trace.keys[i]}</code></div>
      <div class="key-display"><strong>Column IV:</strong> <code>${hex8(trace.colIVs[i])}</code></div>
      ${charTable(shifts, `Encrypting with Key ${i + 1}`, `After round ${i + 1}`, "enc")}
    </div>`).join("");

  const decRoundSections = trace.decShifts.map((shifts, i) => `
    <div class="phase-card">
      <div class="round-header violet">Undo Round ${4 - i} of 4 — Key ${4 - i}</div>
      <div class="key-display"><strong>Key:</strong> <code>${trace.keys[3 - i]}</code></div>
      <div class="key-display"><strong>Column IV:</strong> <code>${hex8(trace.colIVs[3 - i])}</code></div>
      ${charTable(shifts, `Decrypting with Key ${4 - i}`, i === 3 ? "Original recovered ✓" : `After undo ${i + 1}`, "dec")}
    </div>`).join("");

  const journeyRows = trace.encStages.map((s, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#f8f9fa"}">
      <td>${i === 0 ? "Original" : `After encryption round ${i}`}</td>
      <td style="font-family:monospace;font-weight:bold;color:${i === 0 ? "#2563eb" : i === 4 ? "#16a34a" : "#374151"}">${s}</td>
      <td>${i === 0 ? "Starting value" : `Key ${i} applied (forward)`}</td>
    </tr>`).join("") + trace.decStages.slice(1).map((s, i) => `
    <tr style="background:${(i + 1) % 2 === 0 ? "#fff" : "#f8f9fa"}">
      <td>${i === trace.decStages.length - 2 ? "Fully decrypted" : `After undo round ${i + 1}`}</td>
      <td style="font-family:monospace;font-weight:bold;color:${i === trace.decStages.length - 2 ? "#2563eb" : "#374151"}">${s}</td>
      <td>${`Key ${4 - i} reversed`}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>AIRAVATA DEA — Anonymization Trace Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 11px; color: #1e293b; background: #fff; }
    @page { size: A4; margin: 18mm 16mm; }
    @media print { body { font-size: 10px; } .no-print { display: none !important; } }

    /* Header */
    .report-header { border-bottom: 3px solid #4f46e5; padding-bottom: 14px; margin-bottom: 20px; display: flex; align-items: flex-start; justify-content: space-between; }
    .report-title { font-size: 22px; font-weight: 800; color: #3730a3; letter-spacing: -0.5px; }
    .report-subtitle { font-size: 12px; color: #6366f1; margin-top: 2px; }
    .report-meta { text-align: right; font-size: 10px; color: #64748b; line-height: 1.6; }

    /* Params box */
    .params-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; }
    .param-box { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; }
    .param-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 4px; }
    .param-value { font-family: monospace; font-size: 13px; font-weight: 700; color: #1e293b; }
    .seeds-row { display: flex; gap: 6px; }
    .seed-chip { background: #e0e7ff; border: 1px solid #a5b4fc; border-radius: 6px; padding: 3px 8px; font-family: monospace; font-weight: 700; color: #3730a3; }

    /* Phase headings */
    .phase-heading { font-size: 15px; font-weight: 800; color: #1e293b; margin: 24px 0 10px; padding: 8px 14px; background: #f8fafc; border-left: 4px solid #4f46e5; border-radius: 0 6px 6px 0; }
    .phase-sub { font-size: 10px; color: #64748b; font-weight: 400; margin-left: 8px; }
    .phase-card { margin-bottom: 18px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; break-inside: avoid; }
    .round-header { font-weight: 700; font-size: 12px; margin-bottom: 8px; padding: 4px 10px; border-radius: 5px; display: inline-block; }
    .round-header.green { background: #dcfce7; color: #15803d; }
    .round-header.violet { background: #ede9fe; color: #6d28d9; }
    .key-display { font-size: 9.5px; color: #475569; margin-bottom: 5px; line-height: 1.5; }
    .key-display code { font-family: monospace; font-size: 9px; color: #1e293b; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; word-break: break-all; }
    .section-label { font-weight: 600; font-size: 10px; color: #475569; margin: 10px 0 5px; }

    /* Value display row */
    .value-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px 12px; background: #f8fafc; border-radius: 7px; flex-wrap: wrap; }
    .value-row code { font-family: monospace; font-size: 14px; font-weight: 700; color: #1e293b; }
    .tag { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.3px; }
    .tag.blue { background: #dbeafe; color: #1d4ed8; }
    .tag.green { background: #dcfce7; color: #15803d; }
    .tag.blue-dark { background: #1e40af; color: #fff; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
    th { background: #1e293b; color: #f8fafc; font-size: 9.5px; font-weight: 600; text-align: left; padding: 5px 7px; }
    td { padding: 4px 7px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }

    /* Journey table */
    .journey-section { margin-top: 20px; break-inside: avoid; }
    .summary-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 14px 18px; margin-top: 20px; }
    .summary-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #15803d; margin-bottom: 4px; }
    .summary-val { font-family: monospace; font-size: 16px; font-weight: 800; color: #14532d; }
    .match-badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-weight: 700; font-size: 10px; margin-top: 8px; }
    .match-ok { background: #16a34a; color: #fff; }
    .match-fail { background: #dc2626; color: #fff; }

    /* Footer */
    .report-footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }

    /* Print button */
    .print-btn { no-print; position: fixed; top: 20px; right: 20px; background: #4f46e5; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 13px; font-weight: 700; cursor: pointer; z-index: 999; box-shadow: 0 4px 12px rgba(79,70,229,0.4); }
    .print-btn:hover { background: #4338ca; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Save as PDF</button>

  <div class="report-header">
    <div>
      <div class="report-title">AIRAVATA DEA</div>
      <div class="report-subtitle">Anonymization Step-by-Step Trace Report</div>
    </div>
    <div class="report-meta">
      Generated: ${now}<br/>
      Algorithm: 4-Round FPE Chain (xorshift128+)<br/>
      Key size: 256 bits per round
    </div>
  </div>

  <!-- Parameters -->
  <div class="params-grid">
    <div class="param-box">
      <div class="param-label">Seeds (in order)</div>
      <div class="seeds-row">${seeds.map(s => `<span class="seed-chip">${s}</span>`).join("")}</div>
    </div>
    <div class="param-box">
      <div class="param-label">Column name</div>
      <div class="param-value">${colName || "(none)"}</div>
    </div>
    <div class="param-box">
      <div class="param-label">Cell value</div>
      <div class="param-value">${value}</div>
    </div>
  </div>

  <!-- Phase 1: Key Generation -->
  <div class="phase-heading">Phase 1 — Master Key Generation <span class="phase-sub">How 4 seed numbers become 4 secret keys</span></div>
  <p style="font-size:10px;color:#475569;margin-bottom:10px;line-height:1.6">
    Starting from the golden-ratio constant <code style="font-family:monospace;background:#f1f5f9;padding:1px 4px;border-radius:3px">0x9E3779B9</code>,
    each seed is "mixed in" using a Horner-style multiply-XOR fold followed by two avalanche passes (MurmurHash3 finaliser).
    The final rolling accumulator is fed into xorshift128+ to generate 256 random bits — the round key.
  </p>
  <table>
    <thead><tr>
      <th>Round</th><th>Seed</th><th>Rolling before</th><th>After mul⊕seed</th>
      <th>After mix #1</th><th>After mul #2</th><th>After mix #2</th><th>Key (256 bits)</th>
    </tr></thead>
    <tbody>${keyDerivRows}</tbody>
  </table>

  <!-- Phase 2: Encryption -->
  <div class="phase-heading" style="page-break-before:always">Phase 2 — Encryption <span class="phase-sub">4 rounds of Format-Preserving Encryption applied in order</span></div>
  <p style="font-size:10px;color:#475569;margin-bottom:10px;line-height:1.6">
    Each round derives a keystream from the round key and the column IV. Each alphanumeric character is shifted forward
    within its alphabet (digits 0–9, uppercase A–Z, lowercase a–z) by <em>1 + (keyByte mod alphabetSize)</em>.
    Symbols are left unchanged. The 4 rounds are applied in sequence (R1 → R2 → R3 → R4).
  </p>
  ${encRoundSections}

  <!-- Phase 3: Decryption -->
  <div class="phase-heading" style="page-break-before:always">Phase 3 — Decryption <span class="phase-sub">4 rounds reversed in reverse order (R4 → R3 → R2 → R1)</span></div>
  <p style="font-size:10px;color:#475569;margin-bottom:10px;line-height:1.6">
    Decryption uses the <em>identical</em> keystream bytes as the corresponding encryption round (same key + same IV = same bytes).
    Instead of shifting forward, each character is shifted <em>backward</em> by the same amount.
    Rounds are applied in reverse order: R4 first, then R3, R2, R1.
  </p>
  ${decRoundSections}

  <!-- Full journey table -->
  <div class="journey-section">
    <div class="phase-heading">Full Journey — Value at every stage</div>
    <table>
      <thead><tr><th>Stage</th><th>Value</th><th>Note</th></tr></thead>
      <tbody>${journeyRows}</tbody>
    </table>
  </div>

  <!-- Summary -->
  <div class="summary-box">
    <div style="display:flex;gap:40px;align-items:flex-start">
      <div>
        <div class="summary-label">Original value</div>
        <div class="summary-val">${value}</div>
      </div>
      <div style="font-size:20px;margin-top:12px;color:#94a3b8">→</div>
      <div>
        <div class="summary-label">Anonymized value</div>
        <div class="summary-val" style="color:#15803d">${trace.finalEncrypted}</div>
      </div>
      <div style="font-size:20px;margin-top:12px;color:#94a3b8">→</div>
      <div>
        <div class="summary-label">Decrypted value</div>
        <div class="summary-val" style="color:#1d4ed8">${trace.finalDecrypted}</div>
      </div>
    </div>
    <div class="match-badge ${trace.finalDecrypted === value ? "match-ok" : "match-fail"}">
      ${trace.finalDecrypted === value ? "✓ Perfect round-trip — decrypted value matches original exactly" : "⚠ Mismatch detected"}
    </div>
  </div>

  <div class="report-footer">
    <div>AIRAVATA DEA — Anonymization Trace Report</div>
    <div>${now}</div>
  </div>

  <script>
    window.addEventListener("load", () => { setTimeout(() => window.print(), 400); });
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { alert("Please allow pop-ups for this page to download the PDF."); return; }
  win.document.write(html);
  win.document.close();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI pieces
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ValuePill({ value, color }: { value: string; color: string }) {
  return (
    <span className={`inline-block font-mono font-bold px-4 py-2 rounded-xl text-xl tracking-widest ${color}`}>
      {value}
    </span>
  );
}

function BigCard({ children, color = "bg-white border-slate-200" }: { children: React.ReactNode; color?: string }) {
  return (
    <div className={`rounded-2xl border-2 p-8 ${color}`}>
      {children}
    </div>
  );
}

function SeedBox({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-24 h-14 text-center text-2xl font-bold font-mono border-2 border-indigo-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-indigo-700"
      />
    </div>
  );
}

// Small character shift bubble
function ShiftBubble({ shift }: { shift: CharShift }) {
  if (!shift.changed) {
    return (
      <div className="flex flex-col items-center gap-1 px-3">
        <span className="text-2xl font-mono font-bold text-slate-400">{shift.from}</span>
        <span className="text-xs text-slate-300">—</span>
        <span className="text-2xl font-mono font-bold text-slate-400">{shift.to}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1 px-3">
      <span className="text-2xl font-mono font-bold text-blue-600">{shift.from}</span>
      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-1.5 py-0.5">+{shift.k % (shift.from.match(/[a-zA-Z]/) ? 25 : 9)}</span>
      <span className="text-2xl font-mono font-bold text-green-600">{shift.to}</span>
    </div>
  );
}

// Round progress bar
function RoundBar({ stages, active }: { stages: string[]; active: number }) {
  return (
    <div className="flex items-center gap-2 justify-center flex-wrap">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`rounded-lg px-3 py-2 font-mono font-bold text-sm ${i === active ? "bg-indigo-600 text-white" : i < active ? "bg-green-100 text-green-700 border border-green-300" : "bg-slate-100 text-slate-400"}`}>
            {i === 0 ? "Start" : `Round ${i}`}
            <div className="text-xs font-mono mt-0.5 opacity-75">{s}</div>
          </div>
          {i < stages.length - 1 && <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

const STEP_LABELS = [
  "Set Up Your Example",
  "How Keys Are Made",
  "Encrypting",
  "Decrypting",
  "The Full Journey",
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GuideSection() {
  const [step, setStep] = useState(0);
  const [seeds, setSeeds] = useState([42, 137, 2024, 7]);
  const [colName, setColName] = useState("Age");
  const [cellValue, setCellValue] = useState("12345");
  const [encRoundIdx, setEncRoundIdx] = useState(0);
  const [decRoundIdx, setDecRoundIdx] = useState(0);

  const trace = useMemo(() => computeTrace(seeds, colName, cellValue), [seeds, colName, cellValue]);

  function setSeed(i: number, v: number) {
    setSeeds(s => { const c = [...s]; c[i] = isNaN(v) ? 0 : v; return c; });
  }

  const totalSteps = STEP_LABELS.length;

  function goNext() { if (step < totalSteps - 1) setStep(s => s + 1); }
  function goBack() { if (step > 0) setStep(s => s - 1); }

  const encShifts = trace.encShifts[encRoundIdx] ?? [];
  const decShifts = trace.decShifts[decRoundIdx] ?? [];

  return (
    <div className="flex flex-col h-full">

      {/* ── Step progress ─────────────────────────────────────────── */}
      <div className="px-10 pt-6 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center gap-0">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className="flex-1 flex flex-col items-center gap-1.5 group"
            >
              <div className={`w-full h-1.5 rounded-full transition-all ${i <= step ? "bg-indigo-500" : "bg-slate-200"}`} />
              <div className={`text-xs font-medium transition-colors ${i === step ? "text-indigo-700" : i < step ? "text-green-600" : "text-slate-400"} group-hover:text-slate-700 hidden sm:block`}>
                {i < step ? "✓ " : ""}{label}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-2 text-center text-xs text-slate-400">Step {step + 1} of {totalSteps}: <span className="font-semibold text-slate-600">{STEP_LABELS[step]}</span></div>
      </div>

      {/* ── Content area ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-10 py-8">

        {/* ══ STEP 0: Setup ══════════════════════════════════════════ */}
        {step === 0 && (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
              <div className="text-5xl mb-4">👋</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">Let's See How Anonymization Works!</h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                We'll take a real value from your survey data, <strong>scramble it</strong> so no one can tell what it was,<br />
                and then show how we can <strong>get it back</strong> — perfectly — using your secret keys.
              </p>
            </div>

            {/* Big journey preview */}
            <div className="flex items-center justify-center gap-4 py-6 bg-slate-50 rounded-2xl border-2 border-slate-200">
              <div className="text-center">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Your Data</div>
                <ValuePill value={cellValue || "A"} color="text-blue-700 bg-blue-50 border-2 border-blue-200" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <ArrowRight className="w-8 h-8 text-green-400" />
                <span className="text-xs text-slate-400">encrypt</span>
              </div>
              <div className="text-center">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Hidden Value</div>
                <ValuePill value={trace.finalEncrypted} color="text-green-700 bg-green-50 border-2 border-green-200" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <ArrowRight className="w-8 h-8 text-indigo-400" />
                <span className="text-xs text-slate-400">decrypt</span>
              </div>
              <div className="text-center">
                <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Recovered</div>
                <ValuePill value={trace.finalDecrypted} color="text-indigo-700 bg-indigo-50 border-2 border-indigo-200" />
              </div>
            </div>

            {/* Inputs */}
            <BigCard color="bg-white border-indigo-200">
              <h3 className="text-xl font-bold text-slate-800 mb-2">🎛️ Your Secret Password Numbers (Seeds)</h3>
              <p className="text-slate-500 mb-6 text-sm leading-relaxed">
                Think of these 4 numbers like a combination lock. Only someone who knows all 4 numbers <em>in the right order</em> can unlock your data. Try changing them — watch how the scrambled value changes instantly!
              </p>
              <div className="flex gap-4 justify-center mb-6">
                {[0, 1, 2, 3].map(i => (
                  <SeedBox key={i} label={`Seed ${i + 1}`} value={seeds[i]} onChange={v => setSeed(i, v)} />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Column Name</label>
                  <input
                    value={colName}
                    onChange={e => setColName(e.target.value)}
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. Age, Salary, Name"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">Even with the same seeds, different column names produce different scrambled values.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Cell Value to Scramble</label>
                  <input
                    value={cellValue}
                    onChange={e => setCellValue(e.target.value)}
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="e.g. 12345 or Hello"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">Digits stay digits, letters stay letters. The format is always preserved.</p>
                </div>
              </div>
            </BigCard>

            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6">
              <h3 className="font-bold text-amber-800 mb-2 text-lg">💡 Why does this matter?</h3>
              <p className="text-amber-700 leading-relaxed">
                Survey data often contains sensitive information like income, age, or location. Anonymization hides the real values so the data is safe to share — but researchers who hold the secret seeds can still decrypt it back to the original when needed.
              </p>
            </div>
          </div>
        )}

        {/* ══ STEP 1: Keys ════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
              <div className="text-5xl mb-4">🔑</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">Making the Secret Keys</h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Your 4 seed numbers are like ingredients in a recipe.<br />
                We mix them together in a very specific way to bake 4 different <strong>secret keys</strong>.
              </p>
            </div>

            {/* Analogy card */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6">
              <h3 className="font-bold text-blue-800 mb-3 text-lg">🍳 Think of it like cooking</h3>
              <div className="grid grid-cols-4 gap-4 mb-4">
                {seeds.map((s, i) => (
                  <div key={i} className="text-center bg-white rounded-xl p-4 border border-blue-200">
                    <div className="text-3xl mb-1">🥚</div>
                    <div className="text-xs text-blue-500 font-semibold uppercase">Ingredient {i+1}</div>
                    <div className="text-2xl font-bold font-mono text-blue-700 mt-1">{s}</div>
                  </div>
                ))}
              </div>
              <p className="text-blue-700 text-sm text-center">
                These 4 seeds go into a <strong>mathematical blender</strong>. The order matters — swapping any two seeds gives a completely different result.
              </p>
            </div>

            {/* Step-by-step process */}
            <BigCard color="bg-white border-slate-200">
              <h3 className="text-xl font-bold text-slate-800 mb-5">How the blending works</h3>

              <div className="space-y-4">
                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-lg">1</div>
                  <div>
                    <div className="font-semibold text-slate-800 mb-1">Start with a special number</div>
                    <p className="text-slate-500 text-sm mb-2">We begin with the number <strong>2,654,435,769</strong>. This comes from the golden ratio (the same beautiful number found in nature). It's our starting point.</p>
                    <div className="bg-slate-900 rounded-lg px-4 py-2 font-mono text-emerald-300 text-sm inline-block">
                      rolling = 2,654,435,769
                    </div>
                  </div>
                </div>

                {seeds.map((seed, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-lg">{i + 2}</div>
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800 mb-1">Mix in Seed {i + 1} ({seed})</div>
                      <p className="text-slate-500 text-sm mb-2">
                        We multiply our running number by the golden-ratio constant, then XOR it with seed {i + 1}. Then we run it through two "scrambling" steps to spread every bit of the seed throughout the number.
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm font-mono text-indigo-700">seed = {seed}</div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div className="bg-slate-900 rounded-lg px-3 py-2 font-mono text-emerald-300 text-sm">
                          new rolling = 0x{(0).toString().padStart(8, "0")}
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400" />
                        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                          <span className="text-xs text-green-600 block font-semibold uppercase mb-0.5">Key {i+1} (first 16 chars)</span>
                          <span className="font-mono text-green-800 text-xs">{trace.keys[i].slice(0, 16)}…</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </BigCard>

            {/* Show all 4 keys */}
            <div className="rounded-2xl bg-slate-900 p-6">
              <h3 className="text-white font-bold mb-4 text-lg">🗝️ Result: 4 Secret Keys (256 bits each)</h3>
              <div className="space-y-3">
                {trace.keys.map((k, i) => {
                  const colors = ["text-blue-300", "text-violet-300", "text-amber-300", "text-emerald-300"];
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full bg-white/10 shrink-0 mt-0.5 ${colors[i]}`}>Key {i+1}</span>
                      <span className={`font-mono text-xs break-all leading-relaxed ${colors[i]}`}>{k}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-slate-400 text-xs mt-4">Each key is 64 hexadecimal characters = 256 binary digits. This is the same key length used to protect your online banking.</p>
            </div>
          </div>
        )}

        {/* ══ STEP 2: Encryption ══════════════════════════════════════ */}
        {step === 2 && (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
              <div className="text-5xl mb-4">🔐</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">Scrambling Your Value</h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                We apply 4 rounds of scrambling, one for each key.<br />
                Each round <strong>shifts every character</strong> to a different position — like a secret code wheel.
              </p>
            </div>

            {/* Analogy */}
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
              <h3 className="font-bold text-green-800 mb-2 text-lg">🎡 Think of it like a spinning code wheel</h3>
              <p className="text-green-700 leading-relaxed text-sm">
                Imagine a wheel with all 10 digits (0–9) printed around the edge. To encrypt the digit "3", we spin the wheel by a secret amount. If we spin by 4, "3" becomes "7". Letters work the same way — they spin within their own 26-letter wheel. Symbols like spaces or punctuation don't spin at all — they stay unchanged so the format is preserved.
              </p>
            </div>

            {/* Round selector */}
            <div className="flex gap-3 justify-center">
              {[0, 1, 2, 3].map(i => (
                <button
                  key={i}
                  onClick={() => setEncRoundIdx(i)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${encRoundIdx === i ? "bg-green-600 text-white shadow-lg" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  Round {i + 1}
                </button>
              ))}
            </div>

            {/* Round visualization */}
            <BigCard color="bg-white border-green-200">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center text-lg">
                  {encRoundIdx + 1}
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-lg">Round {encRoundIdx + 1} — Using Key {encRoundIdx + 1}</div>
                  <div className="text-sm text-slate-500 font-mono">{trace.keys[encRoundIdx].slice(0, 24)}…</div>
                </div>
              </div>

              {/* Before → After */}
              <div className="flex items-center gap-6 mb-6 p-5 bg-slate-50 rounded-xl">
                <div className="text-center">
                  <div className="text-xs font-semibold text-slate-400 uppercase mb-2">Before Round {encRoundIdx + 1}</div>
                  <ValuePill
                    value={trace.encStages[encRoundIdx]}
                    color="text-blue-700 bg-blue-50 border-2 border-blue-200"
                  />
                </div>
                <ArrowRight className="w-8 h-8 text-green-400 shrink-0" />
                <div className="text-center">
                  <div className="text-xs font-semibold text-slate-400 uppercase mb-2">After Round {encRoundIdx + 1}</div>
                  <ValuePill
                    value={trace.encStages[encRoundIdx + 1]}
                    color="text-green-700 bg-green-50 border-2 border-green-200"
                  />
                </div>
              </div>

              {/* Character-by-character */}
              <div className="mb-4">
                <div className="text-sm font-semibold text-slate-600 mb-3">Character by character shift:</div>
                <div className="flex flex-wrap gap-3 justify-center">
                  {encShifts.slice(0, 12).map((s, i) => <ShiftBubble key={i} shift={s} />)}
                  {encShifts.length > 12 && (
                    <div className="flex items-center text-slate-400 text-sm italic">+{encShifts.length - 12} more…</div>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-6 text-xs flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="font-mono font-bold text-blue-600">X</span> = original character</span>
                  <span className="flex items-center gap-1.5"><span className="text-amber-600 font-semibold bg-amber-50 px-1 rounded">+N</span> = spin amount from key</span>
                  <span className="flex items-center gap-1.5"><span className="font-mono font-bold text-green-600">Y</span> = result after spinning</span>
                  <span className="flex items-center gap-1.5"><span className="font-mono font-bold text-slate-400">—</span> = symbol, not changed</span>
                </div>
              </div>

              <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
                <strong>Why are digits only shifted to digits?</strong> The encryption is "format-preserving" — it's specifically designed to keep numbers as numbers and letters as letters. So "12345" never becomes "AB#7!" — it might become "39461" instead. The data looks real, which is important for surveys.
              </div>
            </BigCard>

            {/* All rounds summary */}
            <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-6">
              <h3 className="font-bold text-slate-700 mb-4 text-base">All 4 rounds applied in order:</h3>
              <RoundBar stages={trace.encStages} active={encRoundIdx + 1} />
            </div>

            <div className="rounded-2xl bg-green-900 p-6 text-center">
              <div className="text-green-300 text-sm font-semibold uppercase tracking-wide mb-2">Final Anonymized Value</div>
              <ValuePill value={trace.finalEncrypted} color="text-green-300 bg-green-800 border-2 border-green-600" />
              <p className="text-green-400 text-sm mt-3">Looking at this value alone, there's no mathematical way to figure out it came from <span className="font-mono font-bold">{cellValue || "A"}</span> without knowing all 4 seeds.</p>
            </div>
          </div>
        )}

        {/* ══ STEP 3: Decryption ══════════════════════════════════════ */}
        {step === 3 && (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
              <div className="text-5xl mb-4">🔓</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">Unscrambling the Value</h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Decryption is the encryption process played <strong>in reverse</strong>.<br />
                We undo round 4 first, then 3, then 2, then 1 — and we get the original back.
              </p>
            </div>

            {/* Analogy */}
            <div className="bg-violet-50 border-2 border-violet-200 rounded-2xl p-6">
              <h3 className="font-bold text-violet-800 mb-2 text-lg">🧥 Like taking off layers of clothing</h3>
              <p className="text-violet-700 text-sm leading-relaxed">
                Encryption was like putting on 4 layers (t-shirt, then jumper, then jacket, then coat). To undress, you <em>must</em> take them off in reverse — coat first, then jacket, then jumper, then t-shirt. Decryption works the same way: we undo round 4, then 3, then 2, then 1. If we did it in the wrong order, we'd get nonsense.
              </p>
            </div>

            {/* Round selector */}
            <div className="flex gap-3 justify-center">
              {[0, 1, 2, 3].map(i => (
                <button
                  key={i}
                  onClick={() => setDecRoundIdx(i)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${decRoundIdx === i ? "bg-violet-600 text-white shadow-lg" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  Undo Round {4 - i}
                </button>
              ))}
            </div>

            {/* Round visualization */}
            <BigCard color="bg-white border-violet-200">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-lg">
                  ↩
                </div>
                <div>
                  <div className="font-bold text-slate-800 text-lg">Undoing Round {4 - decRoundIdx} — Using Key {4 - decRoundIdx}</div>
                  <div className="text-sm text-slate-500 font-mono">{trace.keys[3 - decRoundIdx]?.slice(0, 24)}…</div>
                </div>
              </div>

              {/* Before → After */}
              <div className="flex items-center gap-6 mb-6 p-5 bg-slate-50 rounded-xl">
                <div className="text-center">
                  <div className="text-xs font-semibold text-slate-400 uppercase mb-2">
                    {decRoundIdx === 0 ? "Anonymized value (start)" : `After undo ${decRoundIdx}`}
                  </div>
                  <ValuePill
                    value={trace.decStages[decRoundIdx]}
                    color="text-violet-700 bg-violet-50 border-2 border-violet-200"
                  />
                </div>
                <ArrowRight className="w-8 h-8 text-violet-400 shrink-0" />
                <div className="text-center">
                  <div className="text-xs font-semibold text-slate-400 uppercase mb-2">
                    {decRoundIdx === 3 ? "Original value (recovered!) ✓" : `After undo ${decRoundIdx + 1}`}
                  </div>
                  <ValuePill
                    value={trace.decStages[decRoundIdx + 1]}
                    color={decRoundIdx === 3 ? "text-blue-700 bg-blue-50 border-2 border-blue-400" : "text-indigo-700 bg-indigo-50 border-2 border-indigo-200"}
                  />
                </div>
              </div>

              {/* Character-by-character */}
              <div className="mb-4">
                <div className="text-sm font-semibold text-slate-600 mb-3">Each character is shifted backwards:</div>
                <div className="flex flex-wrap gap-3 justify-center">
                  {decShifts.slice(0, 12).map((s, i) => <ShiftBubble key={i} shift={s} />)}
                  {decShifts.length > 12 && (
                    <div className="flex items-center text-slate-400 text-sm italic">+{decShifts.length - 12} more…</div>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-6 text-xs flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="font-mono font-bold text-blue-600">X</span> = encrypted character</span>
                  <span className="flex items-center gap-1.5"><span className="text-amber-600 font-semibold bg-amber-50 px-1 rounded">+N</span> = same key byte used</span>
                  <span className="flex items-center gap-1.5"><span className="font-mono font-bold text-green-600">Y</span> = recovered character</span>
                </div>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
                <strong>Same keystream bytes — but reversed!</strong> The decryption step uses the <em>exact same</em> keystream bytes as the corresponding encryption round (because the same keys and column IV are used). The only difference is: instead of spinning the wheel <em>forward</em> by N, we spin it <em>backward</em> by N.
              </div>
            </BigCard>

            {/* All undo rounds summary */}
            <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-6">
              <h3 className="font-bold text-slate-700 mb-4 text-base">All 4 rounds undone in reverse order (4 → 3 → 2 → 1):</h3>
              <RoundBar stages={trace.decStages} active={decRoundIdx + 1} />
            </div>

            <div className="rounded-2xl bg-blue-900 p-6 text-center">
              <div className="text-blue-300 text-sm font-semibold uppercase tracking-wide mb-2">Original Value Recovered</div>
              <ValuePill value={trace.finalDecrypted} color="text-blue-300 bg-blue-800 border-2 border-blue-600" />
              <div className="mt-3">
                <span className={`text-sm font-semibold px-3 py-1 rounded-full ${trace.finalDecrypted === (cellValue || "A") ? "bg-green-700 text-green-200" : "bg-red-800 text-red-200"}`}>
                  {trace.finalDecrypted === (cellValue || "A") ? "✓ Exactly matches the original!" : "⚠ Doesn't match — check your inputs"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP 4: Summary ═════════════════════════════════════════ */}
        {step === 4 && (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">The Full Journey</h2>
              <p className="text-lg text-slate-500 leading-relaxed">
                Here's everything that happened to your value from start to finish.
              </p>
            </div>

            {/* Big journey */}
            <div className="rounded-2xl bg-slate-900 p-8">
              {/* Encryption chain */}
              <div className="mb-8">
                <div className="text-slate-400 text-sm font-bold uppercase tracking-wide mb-4">🔐 Encryption (4 rounds forward)</div>
                <div className="space-y-3">
                  {trace.encStages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-20 text-xs text-slate-500 text-right shrink-0">
                        {i === 0 ? "Original" : `After R${i}`}
                      </div>
                      <div className={`font-mono font-bold text-lg px-4 py-2 rounded-xl ${i === 0 ? "text-blue-300 bg-blue-900/50" : i === 4 ? "text-green-300 bg-green-900/50" : "text-slate-300 bg-slate-800"}`}>
                        {stage}
                      </div>
                      {i < trace.encStages.length - 1 && (
                        <div className="text-xs text-slate-500">← Key {i + 1} applied</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-700 my-6" />

              {/* Decryption chain */}
              <div>
                <div className="text-slate-400 text-sm font-bold uppercase tracking-wide mb-4">🔓 Decryption (4 rounds backward)</div>
                <div className="space-y-3">
                  {trace.decStages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-20 text-xs text-slate-500 text-right shrink-0">
                        {i === 0 ? "Encrypted" : `After U${i}`}
                      </div>
                      <div className={`font-mono font-bold text-lg px-4 py-2 rounded-xl ${i === 0 ? "text-green-300 bg-green-900/50" : i === 4 ? "text-blue-300 bg-blue-900/50" : "text-slate-300 bg-slate-800"}`}>
                        {stage}
                      </div>
                      {i < trace.decStages.length - 1 && (
                        <div className="text-xs text-slate-500">← Key {4 - i} reversed</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Final check */}
            <div className={`rounded-2xl p-8 text-center border-2 ${trace.finalDecrypted === (cellValue || "A") ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"}`}>
              <div className="text-4xl mb-3">{trace.finalDecrypted === (cellValue || "A") ? "✅" : "❌"}</div>
              <h3 className={`text-xl font-bold mb-2 ${trace.finalDecrypted === (cellValue || "A") ? "text-green-800" : "text-red-800"}`}>
                {trace.finalDecrypted === (cellValue || "A") ? "Perfect round-trip!" : "Something went wrong"}
              </h3>
              <p className={`text-sm ${trace.finalDecrypted === (cellValue || "A") ? "text-green-700" : "text-red-700"}`}>
                Original: <span className="font-mono font-bold">{cellValue || "A"}</span>
                {" → "}Encrypted: <span className="font-mono font-bold">{trace.finalEncrypted}</span>
                {" → "}Decrypted: <span className="font-mono font-bold">{trace.finalDecrypted}</span>
              </p>
            </div>

            {/* Quick concepts */}
            <BigCard color="bg-white border-slate-200">
              <h3 className="text-xl font-bold text-slate-800 mb-5">📚 Words to Know</h3>
              <div className="space-y-4">
                {[
                  ["Seed", "🌱", "A number you choose. Four seeds together act as your secret password. Change the order and you get completely different results."],
                  ["Key", "🔑", "A long random-looking string made from your seeds. 256 bits long (64 hex characters). Used to control how characters are shifted."],
                  ["Keystream", "🌊", "A sequence of random numbers generated from the key. One number is used per character to decide how far to shift it."],
                  ["Column IV", "📍", "A unique address computed from the column name. Ensures the same value in 'Age' and 'Salary' columns encrypts differently."],
                  ["FPE", "🔄", "Format-Preserving Encryption. Fancy name for 'digits stay digits, letters stay letters'. The shape of the data is preserved."],
                  ["4-Round Chain", "🔗", "We apply encryption 4 times instead of once. This makes it much harder to crack because you'd need to undo all 4 rounds."],
                  ["Modular arithmetic", "🕐", "Like a clock — after 12 comes 1 again. We use this to 'wrap' digits back into 0–9 and letters back into A–Z."],
                ].map(([term, emoji, def]) => (
                  <div key={term as string} className="flex gap-4 items-start">
                    <div className="text-2xl shrink-0">{emoji}</div>
                    <div>
                      <div className="font-bold text-slate-800">{term}</div>
                      <div className="text-slate-500 text-sm leading-relaxed">{def}</div>
                    </div>
                  </div>
                ))}
              </div>
            </BigCard>

            <div className="text-center">
              <button
                onClick={() => setStep(0)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Try different values
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Navigation ────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-200 px-10 py-4 bg-white flex items-center justify-between gap-4">
        <button
          onClick={goBack}
          disabled={step === 0}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-slate-100 text-slate-700 hover:bg-slate-200"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>

        <div className="flex items-center gap-4">
          {/* Dot pips */}
          <div className="flex gap-2">
            {STEP_LABELS.map((_, i) => (
              <button key={i} onClick={() => setStep(i)} className={`h-2.5 rounded-full transition-all ${i === step ? "bg-indigo-600 w-6" : i < step ? "bg-green-400 w-2.5" : "bg-slate-300 w-2.5"}`} />
            ))}
          </div>

          {/* Export PDF button — always visible */}
          <button
            onClick={() => exportTracePDF(trace, seeds, colName, cellValue)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-slate-800 text-white hover:bg-slate-700 transition-colors border border-slate-700"
            title="Download full trace as PDF"
          >
            <Download className="w-4 h-4" />
            Export PDF
          </button>
        </div>

        <button
          onClick={goNext}
          disabled={step === totalSteps - 1}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {step === totalSteps - 2 ? "See Summary" : "Next"}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
