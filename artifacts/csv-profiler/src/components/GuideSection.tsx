import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, BookOpen } from "lucide-react";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Exact algorithm re-implementation for tracing purposes
// Matches anonymize.ts byte-for-byte so every displayed value is real.
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
  const bytes: string[] = [];
  for (let i = 0; i < 32; i++)
    bytes.push(Math.floor(rng() * 256).toString(16).padStart(2, "0"));
  return bytes.join("");
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
  const ksBytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) ksBytes[i] = Math.floor(ksRng() * 256);
  return ksBytes;
}

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

function blendKs(ksArr: Uint8Array[]): Uint8Array {
  const len = ksArr[0].length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let b = ksArr[0][i];
    for (let r = 1; r < ksArr.length; r++) b ^= ksArr[r][i % ksArr[r].length];
    out[i] = b === 0 ? 1 : b;
  }
  return out;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tracing types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface KeyStep {
  roundIdx: number;
  seed: number;
  rollingBefore: number;
  step1_mul_xor: number;
  step2_mix: number;
  step3_mul: number;
  step4_mix: number;
  rollingAfter: number;
  key: string;
}

interface CharTrace {
  original: string;
  code: number;
  k: number;
  resultCode: number;
  result: string;
  type: "leading-digit" | "digit" | "upper" | "lower" | "other";
  encFormula: string;
  decFormula: string;
}

interface RoundTrace {
  roundIdx: number;
  key: string;
  ivSeed: number;
  colIvHex: string;
  inputValue: string;
  outputValue: string;
  chars: CharTrace[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Computation engine — produces full trace from inputs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function computeTrace(seeds: number[], colName: string, cellValue: string) {
  // ── Key generation ──────────────────────────────────────────────
  let rolling = 0x9e3779b9;
  const keySteps: KeyStep[] = [];
  const keys: string[] = [];

  for (let i = 0; i < 4; i++) {
    const seed = seeds[i] ?? 0;
    const rollingBefore = rolling;
    const step1 = (Math.imul(rolling, 0x9e3779b9) ^ (seed >>> 0)) >>> 0;
    const step2 = (step1 ^ (step1 >>> 16)) >>> 0;
    const step3 = Math.imul(step2, 0x85ebca6b) >>> 0;
    const step4 = (step3 ^ (step3 >>> 13)) >>> 0;
    rolling = step4;
    const key = generateRandomKey(rolling);
    keys.push(key);
    keySteps.push({ roundIdx: i, seed, rollingBefore, step1_mul_xor: step1, step2_mix: step2, step3_mul: step3, step4_mix: step4, rollingAfter: rolling, key });
  }

  // ── IV generation ───────────────────────────────────────────────
  const colIVs = keys.map(k => hashColIV(k, colName));

  // ── Encryption rounds ───────────────────────────────────────────
  const encKsArr: Uint8Array[] = keys.map((k, i) =>
    makeCellKsBytes(cellValue.length + 32, k, colIVs[i])
  );

  const encRounds: RoundTrace[] = [];
  let encCurrent = cellValue;
  for (let i = 0; i < 4; i++) {
    const ks = encKsArr[i];
    const isAllNumeric = /^\d+$/.test(encCurrent) && encCurrent.length > 1;
    const chars: CharTrace[] = [];
    let ki = 0;
    let output = "";
    for (let idx = 0; idx < encCurrent.length; idx++) {
      const ch = encCurrent[idx];
      const code = ch.charCodeAt(0);
      const k = ks[ki++ % ks.length];
      let resultCode = code;
      let type: CharTrace["type"] = "other";
      let encFormula = "Unchanged (not alphanumeric)";
      let decFormula = "Unchanged (not alphanumeric)";

      if (code >= 48 && code <= 57) {
        if (isAllNumeric && idx === 0) {
          type = "leading-digit";
          const d = code - 49;
          resultCode = 49 + ((d + 1 + (k % 8) + 81) % 9);
          encFormula = `Leading digit rule (prevents leading zero)\n  d = '${ch}' code(${code}) − 49 = ${d}\n  49 + ((${d} + 1 + (${k} mod 8) + 81) mod 9)\n  = 49 + (${(d + 1 + (k % 8) + 81) % 9}) = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
          const dd = resultCode - 49;
          decFormula = `Reverse leading digit\n  d = '${String.fromCharCode(resultCode)}' code(${resultCode}) − 49 = ${dd}\n  49 + ((${dd} − 1 − (${k} mod 8) + 81) mod 9)\n  = 49 + (${(dd - 1 - (k % 8) + 81) % 9}) = ${code} → '${ch}'`;
        } else {
          type = "digit";
          resultCode = 48 + ((code - 48 + 1 + (k % 9)) % 10);
          encFormula = `Digit shift\n  48 + ((${code} − 48 + 1 + (${k} mod 9)) mod 10)\n  = 48 + ((${code - 48 + 1 + (k % 9)}) mod 10)\n  = 48 + ${(code - 48 + 1 + (k % 9)) % 10} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
          decFormula = `Reverse digit shift\n  48 + ((${resultCode} − 48 − 1 − (${k} mod 9) + 100) mod 10)\n  = 48 + ${(resultCode - 48 - 1 - (k % 9) + 100) % 10} = ${code} → '${ch}'`;
        }
      } else if (code >= 65 && code <= 90) {
        type = "upper";
        resultCode = 65 + ((code - 65 + 1 + (k % 25)) % 26);
        encFormula = `Uppercase shift\n  65 + ((${code} − 65 + 1 + (${k} mod 25)) mod 26)\n  = 65 + ((${code - 65 + 1 + (k % 25)}) mod 26)\n  = 65 + ${(code - 65 + 1 + (k % 25)) % 26} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
        decFormula = `Reverse uppercase shift\n  65 + ((${resultCode} − 65 − 1 − (${k} mod 25) + 2600) mod 26)\n  = 65 + ${(resultCode - 65 - 1 - (k % 25) + 2600) % 26} = ${code} → '${ch}'`;
      } else if (code >= 97 && code <= 122) {
        type = "lower";
        resultCode = 97 + ((code - 97 + 1 + (k % 25)) % 26);
        encFormula = `Lowercase shift\n  97 + ((${code} − 97 + 1 + (${k} mod 25)) mod 26)\n  = 97 + ((${code - 97 + 1 + (k % 25)}) mod 26)\n  = 97 + ${(code - 97 + 1 + (k % 25)) % 26} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
        decFormula = `Reverse lowercase shift\n  97 + ((${resultCode} − 97 − 1 − (${k} mod 25) + 2600) mod 26)\n  = 97 + ${(resultCode - 97 - 1 - (k % 25) + 2600) % 26} = ${code} → '${ch}'`;
      }
      const resultChar = String.fromCharCode(resultCode);
      output += resultChar;
      chars.push({ original: ch, code, k, resultCode, result: resultChar, type, encFormula, decFormula });
    }
    encRounds.push({
      roundIdx: i,
      key: keys[i],
      ivSeed: colIVs[i],
      colIvHex: colIVs[i].toString(16).padStart(8, "0"),
      inputValue: encCurrent,
      outputValue: output,
      chars,
    });
    encCurrent = output;
  }

  // Tiebreaker check
  const encryptedValue = encCurrent;
  const tiebreakerUsed = encryptedValue === cellValue;
  let finalEncryptedValue = encryptedValue;
  if (tiebreakerUsed) {
    const blend = blendKs(encKsArr);
    finalEncryptedValue = encryptFPECell(blend, encryptedValue);
  }

  // ── Decryption rounds ───────────────────────────────────────────
  const decRounds: RoundTrace[] = [];
  let decCurrent = finalEncryptedValue;

  if (tiebreakerUsed) {
    const blend = blendKs(encKsArr);
    const out = decryptFPECell(blend, decCurrent);
    decRounds.push({
      roundIdx: -1,
      key: "blended",
      ivSeed: 0,
      colIvHex: "tiebreaker",
      inputValue: decCurrent,
      outputValue: out,
      chars: [],
    });
    decCurrent = out;
  }

  for (let i = 3; i >= 0; i--) {
    const ks = encKsArr[i];
    const isAllNumeric = /^\d+$/.test(decCurrent) && decCurrent.length > 1;
    const chars: CharTrace[] = [];
    let ki = 0;
    let output = "";
    for (let idx = 0; idx < decCurrent.length; idx++) {
      const ch = decCurrent[idx];
      const code = ch.charCodeAt(0);
      const k = ks[ki++ % ks.length];
      let resultCode = code;
      let type: CharTrace["type"] = "other";
      let encFormula = "";
      let decFormula = "Unchanged (not alphanumeric)";

      if (code >= 48 && code <= 57) {
        if (isAllNumeric && idx === 0) {
          type = "leading-digit";
          const d = code - 49;
          resultCode = 49 + ((d - 1 - (k % 8) + 81) % 9);
          decFormula = `Reverse leading digit\n  d = '${ch}' code(${code}) − 49 = ${d}\n  49 + ((${d} − 1 − (${k} mod 8) + 81) mod 9)\n  = 49 + ${(d - 1 - (k % 8) + 81) % 9} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
        } else {
          type = "digit";
          resultCode = 48 + ((code - 48 - 1 - (k % 9) + 100) % 10);
          decFormula = `Reverse digit\n  48 + ((${code} − 48 − 1 − (${k} mod 9) + 100) mod 10)\n  = 48 + ${(code - 48 - 1 - (k % 9) + 100) % 10} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
        }
      } else if (code >= 65 && code <= 90) {
        type = "upper";
        resultCode = 65 + ((code - 65 - 1 - (k % 25) + 2600) % 26);
        decFormula = `Reverse uppercase\n  65 + ((${code} − 65 − 1 − (${k} mod 25) + 2600) mod 26)\n  = 65 + ${(code - 65 - 1 - (k % 25) + 2600) % 26} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
      } else if (code >= 97 && code <= 122) {
        type = "lower";
        resultCode = 97 + ((code - 97 - 1 - (k % 25) + 2600) % 26);
        decFormula = `Reverse lowercase\n  97 + ((${code} − 97 − 1 − (${k} mod 25) + 2600) mod 26)\n  = 97 + ${(code - 97 - 1 - (k % 25) + 2600) % 26} = ${resultCode} → '${String.fromCharCode(resultCode)}'`;
      }
      const resultChar = String.fromCharCode(resultCode);
      output += resultChar;
      chars.push({ original: ch, code, k, resultCode, result: resultChar, type, encFormula, decFormula });
    }
    decRounds.push({
      roundIdx: i,
      key: keys[i],
      ivSeed: colIVs[i],
      colIvHex: colIVs[i].toString(16).padStart(8, "0"),
      inputValue: decCurrent,
      outputValue: output,
      chars,
    });
    decCurrent = output;
  }

  return { keySteps, keys, colIVs, encRounds, decRounds, encryptedValue: finalEncryptedValue, decryptedValue: decCurrent, tiebreakerUsed };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI helper components
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SectionBox({ title, subtitle, icon, color, children, defaultOpen = false }: {
  title: string; subtitle: string; icon: string; color: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border-2 ${color} overflow-hidden mb-4`}>
      <button
        className="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-slate-50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <div className="font-bold text-slate-800 text-base">{title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
          </div>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1 bg-white border-t border-slate-100">{children}</div>}
    </div>
  );
}

function Callout({ color, icon, title, children }: { color: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-4 mb-4 ${color}`}>
      <div className="font-semibold text-sm mb-1">{icon} {title}</div>
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function Value({ label, value, color = "text-indigo-700 bg-indigo-50", mono = true }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-xs text-slate-500 w-28 shrink-0">{label}</span>
      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${color} ${mono ? "font-mono" : ""} break-all`}>{value}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 px-4 py-3 bg-slate-900 rounded-lg font-mono text-xs text-emerald-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
      {children}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{children}</span>;
}

function typeColor(type: CharTrace["type"]) {
  if (type === "digit" || type === "leading-digit") return "text-blue-700 bg-blue-50";
  if (type === "upper") return "text-violet-700 bg-violet-50";
  if (type === "lower") return "text-emerald-700 bg-emerald-50";
  return "text-slate-500 bg-slate-100";
}

function StepCard({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-5">
      <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold mt-0.5">
        {num}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-slate-800 text-sm mb-2">{title}</div>
        {children}
      </div>
    </div>
  );
}

// Character table for a round
function CharTable({ chars, phase }: { chars: CharTrace[]; phase: "enc" | "dec" }) {
  const MAX_SHOWN = 8;
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? chars : chars.slice(0, MAX_SHOWN);

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200 w-6">#</th>
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200">Input char</th>
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200">Type</th>
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200">Key byte (k)</th>
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200">Operation</th>
              <th className="px-2 py-2 text-left text-slate-600 font-semibold border-b border-slate-200">Output char</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((c, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                <td className="px-2 py-1.5 border-b border-slate-100 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1.5 border-b border-slate-100">
                  <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${typeColor(c.type)}`}>
                    '{c.original}'
                  </span>
                  <span className="ml-1 text-slate-400">({c.code})</span>
                </td>
                <td className="px-2 py-1.5 border-b border-slate-100">
                  <Badge color={typeColor(c.type)}>
                    {c.type === "leading-digit" ? "leading digit" : c.type === "digit" ? "digit" : c.type === "upper" ? "uppercase" : c.type === "lower" ? "lowercase" : "symbol"}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 border-b border-slate-100 font-mono text-amber-700 font-semibold">{c.k}</td>
                <td className="px-2 py-1.5 border-b border-slate-100">
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-tight">
                    {phase === "enc" ? c.encFormula : c.decFormula}
                  </pre>
                </td>
                <td className="px-2 py-1.5 border-b border-slate-100">
                  <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${phase === "enc" ? "text-green-700 bg-green-50" : "text-blue-700 bg-blue-50"}`}>
                    '{c.result}'
                  </span>
                  <span className="ml-1 text-slate-400">({c.resultCode})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chars.length > MAX_SHOWN && (
        <button
          className="mt-2 text-xs text-indigo-600 hover:underline font-medium"
          onClick={() => setShowAll(v => !v)}
        >
          {showAll ? "Show fewer characters" : `Show all ${chars.length} characters ↓`}
        </button>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Guide component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function GuideSection() {
  const [seeds, setSeeds] = useState([42, 137, 2024, 7]);
  const [colName, setColName] = useState("Age");
  const [cellValue, setCellValue] = useState("12345");

  const trace = useMemo(
    () => computeTrace(seeds, colName, cellValue.trim() || "A"),
    [seeds, colName, cellValue]
  );

  const ROUND_COLORS = [
    "border-blue-300", "border-violet-300", "border-amber-300", "border-emerald-300"
  ];
  const ROUND_TAGS = [
    "text-blue-700 bg-blue-50", "text-violet-700 bg-violet-50",
    "text-amber-700 bg-amber-50", "text-emerald-700 bg-emerald-50"
  ];

  function handleSeed(idx: number, val: string) {
    const n = parseInt(val, 10);
    setSeeds(s => { const copy = [...s]; copy[idx] = isNaN(n) ? 0 : n; return copy; });
  }

  return (
    <div className="space-y-1">

      {/* ─── Intro ────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-5 h-5 text-indigo-600" />
          <span className="font-bold text-indigo-800 text-base">How Anonymization Works — Step by Step</span>
        </div>
        <p className="text-sm text-indigo-700 leading-relaxed mb-2">
          This guide walks you through the <strong>exact</strong> calculations the system performs when it anonymizes your data. Every number shown below is computed live from your example inputs — not a diagram or approximation.
        </p>
        <p className="text-xs text-indigo-600 leading-relaxed">
          No technical background required. Every concept — seeds, keys, keystreams, character shifting — is explained in plain language before the maths.
        </p>
      </div>

      {/* ─── Inputs ───────────────────────────────────────────────── */}
      <SectionBox title="Your Example Inputs" subtitle="Change these values — all calculations below update instantly" icon="📥" color="border-slate-300" defaultOpen={true}>
        <Callout color="bg-amber-50 text-amber-800 border border-amber-200" icon="💡" title="What are seeds?">
          Think of seeds as a <strong>password made of numbers</strong>. The system uses four numbers in a specific order to generate the encryption keys. If you change any seed — or swap two seeds around — you get a completely different set of keys, and your data encrypts to a different result. The order matters.
        </Callout>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Four Seed Values (your "password numbers")</label>
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex-1">
                  <div className="text-xs text-slate-400 mb-1 text-center">Seed {i + 1}</div>
                  <input
                    type="number"
                    value={seeds[i]}
                    onChange={e => handleSeed(i, e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Column Name</label>
              <input
                type="text"
                value={colName}
                onChange={e => setColName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. Age, Salary, Name"
              />
              <p className="text-xs text-slate-400 mt-1">Each column name creates a different keystream even with the same seeds.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cell Value to Anonymize</label>
              <input
                type="text"
                value={cellValue}
                onChange={e => setCellValue(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. 12345 or Hello"
              />
              <p className="text-xs text-slate-400 mt-1">Digits stay digits, letters stay letters. Format is always preserved.</p>
            </div>
          </div>
        </div>

        {/* Summary result */}
        <div className="rounded-lg bg-slate-900 p-4 mt-2">
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-slate-400 mb-1">Original value</div>
              <div className="font-mono text-blue-300 font-bold text-lg">{cellValue || "A"}</div>
            </div>
            <div className="text-slate-500 text-2xl">→</div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Anonymized value</div>
              <div className="font-mono text-green-300 font-bold text-lg">{trace.encryptedValue}</div>
            </div>
            <div className="text-slate-500 text-2xl">→</div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Decrypted back</div>
              <div className="font-mono text-amber-300 font-bold text-lg">{trace.decryptedValue}</div>
            </div>
            <div>
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${trace.decryptedValue === (cellValue || "A") ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                {trace.decryptedValue === (cellValue || "A") ? "✓ Perfect round-trip" : "⚠ Mismatch"}
              </span>
            </div>
          </div>
        </div>
      </SectionBox>

      {/* ─── Phase 1: Master Key Generation ─────────────────────── */}
      <SectionBox title="Phase 1 — Master Key Generation" subtitle="How your 4 seed numbers become 4 encryption keys" icon="🔑" color="border-blue-300" defaultOpen={true}>

        <Callout color="bg-blue-50 text-blue-800 border border-blue-200" icon="📖" title="Plain-language explanation">
          A <strong>key</strong> is a long string of random-looking hexadecimal characters (0–9, a–f) that controls how characters get shifted. You have 4 seeds, so the system creates 4 different keys — one per encryption round. Each key is 64 characters long (256 bits). The seeds are processed one at a time in order, and each seed "mixes into" a running total called the <strong>rolling accumulator</strong>. This chain means that if you swap Seed 2 and Seed 3, every key from Round 2 onwards changes.
        </Callout>

        <StepCard num={1} title="Start with the Golden Ratio constant">
          <p className="text-xs text-slate-600 mb-2 leading-relaxed">
            Before processing any seed, the rolling accumulator is set to a special mathematical constant: <strong>0x9E3779B9</strong> (decimal: 2,654,435,769). This is derived from the golden ratio (φ = 1.618…) and is widely used in hash functions to spread out bits well. It gives us a non-zero, well-distributed starting point.
          </p>
          <Mono>{`rolling₀ = 0x9E3779B9 = 2,654,435,769 (decimal)`}</Mono>
        </StepCard>

        {trace.keySteps.map((step, i) => (
          <StepCard key={i} num={i + 2} title={`Process Seed ${i + 1} (value: ${step.seed}) → generate Round ${i + 1} Key`}>
            <Callout color="bg-slate-50 text-slate-700 border border-slate-200" icon="🔢" title="What is Horner-style mixing?">
              We multiply the accumulator by the golden-ratio constant (spreading bits wide), then XOR with the seed value. XOR (exclusive-or) combines two numbers bit by bit: if the bits differ the result is 1, otherwise 0. After mixing in the seed, we apply two more "avalanche" operations to make sure every bit of the seed influences many bits of the result. These are standard techniques from the <strong>MurmurHash3</strong> algorithm.
            </Callout>

            <div className="grid grid-cols-1 gap-1 mb-3">
              <Value label="rolling (before)" value={`0x${step.rollingBefore.toString(16).toUpperCase().padStart(8,"0")} = ${step.rollingBefore}`} color="text-blue-700 bg-blue-50" />
              <Value label={`Seed ${i+1}`} value={`${step.seed}`} color="text-slate-700 bg-slate-100" />
            </div>

            <Mono>{`Step A — Multiply accumulator by golden-ratio prime, then XOR with seed:
  rolling × 0x9E3779B9 ⊕ ${step.seed}
  = 0x${step.rollingBefore.toString(16).padStart(8,"0")} × 0x9E3779B9 ⊕ ${step.seed}
  = 0x${step.step1_mul_xor.toString(16).padStart(8,"0")} (${step.step1_mul_xor})

Step B — Avalanche mix #1  (XOR with right-shift by 16 bits):
  0x${step.step1_mul_xor.toString(16).padStart(8,"0")} ⊕ (0x${step.step1_mul_xor.toString(16).padStart(8,"0")} >>> 16)
  = 0x${step.step2_mix.toString(16).padStart(8,"0")} (${step.step2_mix})

Step C — Multiply by MurmurHash3 constant 0x85EBCA6B:
  0x${step.step2_mix.toString(16).padStart(8,"0")} × 0x85EBCA6B
  = 0x${step.step3_mul.toString(16).padStart(8,"0")} (${step.step3_mul})

Step D — Avalanche mix #2  (XOR with right-shift by 13 bits):
  0x${step.step3_mul.toString(16).padStart(8,"0")} ⊕ (0x${step.step3_mul.toString(16).padStart(8,"0")} >>> 13)
  = 0x${step.step4_mix.toString(16).padStart(8,"0")} (${step.step4_mix})

rolling after Seed ${i+1} = 0x${step.rollingAfter.toString(16).padStart(8,"0")}`}</Mono>

            <div className="mt-3">
              <p className="text-xs text-slate-600 mb-2 leading-relaxed">
                The final rolling value is fed into the <strong>xorshift128+</strong> pseudo-random number generator to produce 32 random bytes (256 bits). Those bytes, written as hexadecimal, become the round key. The PRNG is seeded with <code className="bg-slate-100 px-1 rounded">rolling ⊕ 0xDEADBEEF</code> — mixing in another constant to further decorrelate the key from the accumulator value.
              </p>
              <div className="rounded-lg border border-blue-200 p-3 bg-blue-50">
                <div className="text-xs font-semibold text-blue-700 mb-1">Round {i + 1} Key (64 hex characters = 256 bits):</div>
                <div className="font-mono text-xs text-blue-900 break-all">{step.key}</div>
              </div>
            </div>
          </StepCard>
        ))}

        <div className="rounded-lg bg-slate-900 p-4 mt-2">
          <div className="text-xs text-slate-400 mb-3 font-semibold">All 4 keys generated from seeds [{seeds.join(", ")}]:</div>
          {trace.keys.map((k, i) => (
            <div key={i} className="flex items-start gap-3 mb-2">
              <Badge color={ROUND_TAGS[i]}>Round {i + 1}</Badge>
              <span className="font-mono text-xs text-slate-300 break-all">{k}</span>
            </div>
          ))}
        </div>
      </SectionBox>

      {/* ─── Phase 2: Encryption ─────────────────────────────────── */}
      <SectionBox title="Phase 2 — Anonymization (Encryption)" subtitle="4 independent rounds of Format-Preserving Encryption applied to your cell value" icon="🔐" color="border-green-300" defaultOpen={true}>

        <Callout color="bg-green-50 text-green-800 border border-green-200" icon="📖" title="What is Format-Preserving Encryption (FPE)?">
          Normal encryption turns "12345" into something like "xK9#mP". FPE is different — it guarantees the output looks like the input: digits stay digits, letters stay letters, and the length never changes. AIRAVATA DEA achieves this by <strong>shifting each character within its own alphabet</strong>. A digit is shifted to another digit, a letter to another letter of the same case. Each shift is controlled by a random "keystream byte" (a number 0–255) derived from the encryption key.
        </Callout>

        <Callout color="bg-amber-50 text-amber-800 border border-amber-200" icon="🌊" title="What is a keystream?">
          A keystream is a sequence of random-looking bytes (numbers 0–255) produced by running the key through the <strong>xorshift128+</strong> pseudo-random number generator. The generator is seeded by XOR-ing the first 8 characters of the round key with a <strong>column IV</strong> (a number derived from the column name). This means the same value in a different column encrypts differently. One keystream byte is consumed per character of the cell value.
        </Callout>

        {/* Column IVs */}
        <StepCard num={1} title={`Compute Column IV for column "${colName}"`}>
          <p className="text-xs text-slate-600 mb-2 leading-relaxed">
            The Column IV (Initialization Vector) is a 32-bit number computed from the round key and the column name using a fast hash function. It ensures that the same cell value (e.g., "100") in two different columns ("Age" vs "Salary") produces different anonymized outputs. The formula loops through each character of <code className="bg-slate-100 px-1 rounded">"COL" + columnName</code> and mixes it into the hash using a linear congruential mixing step.
          </p>
          {trace.colIVs.map((iv, i) => (
            <div key={i} className="flex items-center gap-3 mb-1.5">
              <Badge color={ROUND_TAGS[i]}>Round {i + 1}</Badge>
              <span className="text-xs text-slate-600 font-mono">
                Column IV = <strong className="text-slate-800">0x{iv.toString(16).padStart(8,"0")}</strong> ({iv})
              </span>
            </div>
          ))}
        </StepCard>

        {/* Each encryption round */}
        {trace.encRounds.map((round, i) => (
          <div key={i} className={`rounded-xl border-2 ${ROUND_COLORS[i]} p-4 mb-4`}>
            <div className="flex items-center gap-2 mb-3">
              <Badge color={ROUND_TAGS[i]}>Round {i + 1}</Badge>
              <span className="text-sm font-bold text-slate-700">Encryption using Seed {i + 1}'s key</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <Value label="Input value" value={`"${round.inputValue}"`} color="text-blue-700 bg-blue-50" />
              <Value label="Output value" value={`"${round.outputValue}"`} color="text-green-700 bg-green-50" />
              <Value label="Key (first 16 chars)" value={`${round.key.slice(0, 16)}…`} color="text-slate-700 bg-slate-100" />
              <Value label="Column IV (hex)" value={`0x${round.colIvHex}`} color="text-amber-700 bg-amber-50" />
            </div>

            <p className="text-xs text-slate-600 mb-2 leading-relaxed">
              Each character in <strong>"{round.inputValue}"</strong> is shifted by at least 1 position within its alphabet. The shift amount is <strong>1 + (keystream_byte mod alphabet_size)</strong>. The minimum shift of 1 guarantees the encrypted character is <em>never identical</em> to the original within a single round. Below is the character-by-character breakdown:
            </p>

            {round.chars.length > 0 && <CharTable chars={round.chars} phase="enc" />}
          </div>
        ))}

        {trace.tiebreakerUsed && (
          <Callout color="bg-orange-50 text-orange-800 border border-orange-200" icon="⚡" title="Tiebreaker Round Applied">
            In a rare case (all four round shifts summed to a multiple of the alphabet size), the output after 4 rounds was identical to the original. A 5th "tiebreaker" round was automatically applied using a blended keystream (XOR of all 4 individual keystreams). Decryption detects and reverses this automatically.
          </Callout>
        )}

        <div className="rounded-lg bg-slate-900 p-4 mt-2">
          <div className="text-xs text-slate-400 mb-2 font-semibold">Encryption summary — value after each round:</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Original</div>
              <div className="font-mono text-blue-300 font-bold">"{cellValue || "A"}"</div>
            </div>
            {trace.encRounds.map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-slate-500">→</span>
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">After round {i + 1}</div>
                  <div className={`font-mono font-bold ${i === 3 ? "text-green-300" : "text-slate-300"}`}>"{r.outputValue}"</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700">
            <span className="text-xs text-slate-400">Final anonymized value: </span>
            <span className="font-mono text-green-300 font-bold text-base ml-2">"{trace.encryptedValue}"</span>
          </div>
        </div>
      </SectionBox>

      {/* ─── Phase 3: Decryption ─────────────────────────────────── */}
      <SectionBox title="Phase 3 — Decryption (Reconstruction)" subtitle="Exact reverse of encryption — recovers the original value using the same keys" icon="🔓" color="border-violet-300" defaultOpen={true}>

        <Callout color="bg-violet-50 text-violet-800 border border-violet-200" icon="📖" title="How decryption works">
          Decryption is encryption played backwards. Since we know all 4 keys (they come from the same seeds), we can reverse each round in reverse order: Round 4 first, then Round 3, then Round 2, then Round 1. Each character shift is mathematically invertible — instead of adding the keystream byte, we subtract it (with the same modular arithmetic to stay within the alphabet). The keystream bytes are identical to those used during encryption, because the keys and IVs are the same.
        </Callout>

        <Callout color="bg-blue-50 text-blue-800 border border-blue-200" icon="🔁" title="Why is the order reversed?">
          Think of encryption like putting on layers of clothing (jacket over shirt over t-shirt). To undress, you must remove in reverse: jacket first, then shirt, then t-shirt. The same logic applies here — the last encryption round must be undone first, because it was applied last.
        </Callout>

        <StepCard num={1} title={`Start with the anonymized value: "${trace.encryptedValue}"`}>
          <Value label="Starting value" value={`"${trace.encryptedValue}"`} color="text-violet-700 bg-violet-50" />
          <p className="text-xs text-slate-600 mt-1">This is the anonymized output from Phase 2. We now reverse the 4 rounds in order: Round 4 → Round 3 → Round 2 → Round 1.</p>
        </StepCard>

        {trace.decRounds.filter(r => r.roundIdx >= 0).map((round, renderIdx) => {
          const roundActualIdx = round.roundIdx;
          return (
            <div key={renderIdx} className={`rounded-xl border-2 ${ROUND_COLORS[roundActualIdx]} p-4 mb-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Badge color={ROUND_TAGS[roundActualIdx]}>Reverse Round {roundActualIdx + 1}</Badge>
                <span className="text-sm font-bold text-slate-700">Decryption using Seed {roundActualIdx + 1}'s key</span>
                <span className="text-xs text-slate-400">(applied {renderIdx + 1}{renderIdx === 0 ? "st" : renderIdx === 1 ? "nd" : renderIdx === 2 ? "rd" : "th"} during decryption)</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <Value label="Input value" value={`"${round.inputValue}"`} color="text-violet-700 bg-violet-50" />
                <Value label="Output value" value={`"${round.outputValue}"`} color="text-blue-700 bg-blue-50" />
                <Value label="Key (first 16 chars)" value={`${round.key.slice(0, 16)}…`} color="text-slate-700 bg-slate-100" />
                <Value label="Column IV (hex)" value={`0x${round.colIvHex}`} color="text-amber-700 bg-amber-50" />
              </div>

              <p className="text-xs text-slate-600 mb-2 leading-relaxed">
                The same keystream bytes from Round {roundActualIdx + 1} encryption are reused here (same key + same IV = identical keystream). But instead of <em>adding</em> the shift, we <em>subtract</em> it. The large offsets (+81, +100, +2600) ensure the result is never negative before taking the modulo.
              </p>

              {round.chars.length > 0 && <CharTable chars={round.chars} phase="dec" />}
            </div>
          );
        })}

        <div className="rounded-lg bg-slate-900 p-4 mt-2">
          <div className="text-xs text-slate-400 mb-2 font-semibold">Decryption summary — value after each reverse round:</div>
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">Anonymized</div>
              <div className="font-mono text-violet-300 font-bold">"{trace.encryptedValue}"</div>
            </div>
            {trace.decRounds.filter(r => r.roundIdx >= 0).map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-slate-500">→</span>
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">After undo {i + 1}</div>
                  <div className={`font-mono font-bold ${i === 3 ? "text-blue-300" : "text-slate-300"}`}>"{r.outputValue}"</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700 flex items-center gap-3">
            <div>
              <span className="text-xs text-slate-400">Reconstructed original: </span>
              <span className="font-mono text-blue-300 font-bold text-base ml-2">"{trace.decryptedValue}"</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${trace.decryptedValue === (cellValue || "A") ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
              {trace.decryptedValue === (cellValue || "A") ? "✓ Matches original exactly" : "⚠ Mismatch"}
            </span>
          </div>
        </div>

        {/* Key concepts recap */}
        <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200 p-5">
          <div className="font-bold text-slate-800 mb-3 text-sm">📋 Key Concepts Recap</div>
          <div className="grid grid-cols-1 gap-2 text-xs text-slate-600">
            {[
              ["Seed", "A number you provide. Four seeds in a specific order become the four encryption keys. Changing any seed or their order produces entirely different keys."],
              ["Rolling Accumulator", "A running number that folds in each seed one by one. Because each seed mixes into the same running total, the sequence of seeds is fully encoded — swapping any two seeds changes all subsequent keys."],
              ["xorshift128+", "A fast pseudo-random number generator used to produce both the 256-bit keys and the per-character keystream bytes. 'Pseudo-random' means deterministic — given the same seed, it always produces the same sequence."],
              ["Format-Preserving Encryption (FPE)", "An encryption method that keeps the output in the same format as the input. Digits stay digits, letters stay letters, and the length is unchanged. Achieved here by shifting characters within their own alphabet."],
              ["Keystream byte (k)", "A number 0–255 drawn from the xorshift128+ generator. One byte is used per character. It controls how far each character is shifted. The minimum shift is always 1, so no character ever maps to itself in a single round."],
              ["Column IV", "A per-column initialization vector derived from the key and the column name. Ensures the same cell value (e.g., '100') in different columns encrypts to different results, preventing cross-column correlation attacks."],
              ["4-Round Chain", "Encryption is applied four times, each with a different key. The net shift is the sum of four independent random shifts, making brute-force reversal impractical without all four seeds."],
              ["Tiebreaker", "An extremely rare 5th round applied only if the 4-round result accidentally equals the original value. It uses a blended keystream (XOR of all four) and is automatically detected and reversed during decryption."],
              ["Modular arithmetic (mod)", "Keeps a number within a fixed range by wrapping around, like a clock. 'mod 10' means: divide by 10 and take the remainder. Used here to keep character codes within their alphabet range."],
              ["XOR (⊕)", "A bitwise operation on two numbers. Each bit of the result is 1 if the corresponding bits of the inputs differ, and 0 if they are the same. Used throughout for mixing and combining values."],
            ].map(([term, def]) => (
              <div key={term} className="flex gap-2">
                <span className="font-semibold text-slate-700 w-40 shrink-0">{term}</span>
                <span className="leading-relaxed">{def}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionBox>
    </div>
  );
}
