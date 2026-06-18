import { pageCache } from "@/pages/RiskAssessmentSingle";
import { Shield, TrendingDown, TrendingUp, Minus, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number) { return `${(v * 100).toFixed(1)}%`; }

function riskBadge(risk: number) {
  if (risk > 0.2) return { label: "HIGH", cls: "bg-red-100 text-red-800 border-red-200" };
  if (risk > 0.05) return { label: "MEDIUM", cls: "bg-amber-100 text-amber-800 border-amber-200" };
  return { label: "LOW", cls: "bg-green-100 text-green-800 border-green-200" };
}

type DeltaDir = "good" | "bad" | "neutral";

interface DeltaProps {
  orig: number;
  anon: number;
  lowerIsBetter?: boolean;
  fmt?: (v: number) => string;
}

function Delta({ orig, anon, lowerIsBetter = true, fmt = pct }: DeltaProps) {
  const diff = anon - orig;
  const improved = lowerIsBetter ? diff < -0.0001 : diff > 0.0001;
  const worsened = lowerIsBetter ? diff > 0.0001 : diff < -0.0001;
  const dir: DeltaDir = improved ? "good" : worsened ? "bad" : "neutral";
  const color = dir === "good" ? "text-green-600" : dir === "bad" ? "text-red-600" : "text-gray-400";
  const Icon = dir === "good" ? TrendingDown : dir === "bad" ? TrendingUp : Minus;
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {sign}{fmt(diff)}
    </span>
  );
}

// ── Column matching ────────────────────────────────────────────────────────────

interface MatchedCol {
  origName: string;
  anonName: string;
  renamed: boolean;
  valuesChanged: boolean;
  origUniques: number;
  anonUniques: number;
  sampleOrigVals: string[];
  sampleAnonVals: string[];
}

function matchColumns(
  origHeaders: string[],
  anonHeaders: string[],
  origRows: Record<string, string | number>[],
  anonRows: Record<string, string | number>[],
) {
  // Build lowercase → exact name maps
  const origByLc = new Map<string, string>();
  origHeaders.forEach(h => origByLc.set(h.toLowerCase(), h));

  const anonByLc = new Map<string, string>();
  anonHeaders.forEach(h => anonByLc.set(h.toLowerCase(), h));

  const matched: MatchedCol[] = [];
  const suppressed: string[] = [];   // in original, no case-insensitive match in anon
  const added: string[] = [];        // in anonymized, no case-insensitive match in orig

  // Walk original headers
  origByLc.forEach((origName, lc) => {
    if (anonByLc.has(lc)) {
      const anonName = anonByLc.get(lc)!;
      const renamed = origName !== anonName;

      // Sample up to 2000 rows to compare value sets
      const SAMPLE = 2000;
      const origVals = new Set<string>();
      const anonVals  = new Set<string>();
      const n = Math.min(origRows.length, SAMPLE);
      for (let i = 0; i < n; i++) origVals.add(String(origRows[i][origName] ?? ""));
      const m = Math.min(anonRows.length, SAMPLE);
      for (let i = 0; i < m; i++) anonVals.add(String(anonRows[i][anonName] ?? ""));

      // Values changed if the sets differ
      const valuesChanged =
        [...origVals].some(v => !anonVals.has(v)) ||
        [...anonVals].some(v => !origVals.has(v));

      const sampleOrigVals = [...origVals].slice(0, 4);
      const sampleAnonVals = [...anonVals].slice(0, 4);

      matched.push({
        origName,
        anonName,
        renamed,
        valuesChanged,
        origUniques: origVals.size,
        anonUniques: anonVals.size,
        sampleOrigVals,
        sampleAnonVals,
      });
    } else {
      suppressed.push(origName);
    }
  });

  // Walk anonymized headers for truly new columns
  anonByLc.forEach((anonName, lc) => {
    if (!origByLc.has(lc)) added.push(anonName);
  });

  const anonymized = matched.filter(c => c.renamed || c.valuesChanged);
  const preserved  = matched.filter(c => !c.renamed && !c.valuesChanged);

  return { matched, suppressed, added, anonymized, preserved };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RiskAssessmentComparison() {
  const orig = pageCache.original;
  const anon = pageCache.anonymized;
  const hasOrig = !!orig.result && !!orig.loadedFile;
  const hasAnon = !!anon.result && !!anon.loadedFile;

  if (!hasOrig || !hasAnon) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-teal-600 flex items-center justify-center mx-auto">
          <Shield className="w-7 h-7 text-white" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-black">Comparison Not Ready</h1>
          <p className="text-sm text-gray-500 max-w-sm">
            Run a complete risk assessment on both the <strong>Original</strong> and <strong>Anonymized</strong> files first, then return here to see the comparison.
          </p>
        </div>
        <div className="flex gap-4 mt-2">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold ${hasOrig ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
            {hasOrig ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            📄 Original File {hasOrig ? "✓ Ready" : "— Not analysed"}
          </div>
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold ${hasAnon ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
            {hasAnon ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            🔒 Anonymized File {hasAnon ? "✓ Ready" : "— Not analysed"}
          </div>
        </div>
      </div>
    );
  }

  const or = orig.result!;
  const ar = anon.result!;

  const { suppressed: suppressedCols, added: addedCols, anonymized: anonymizedCols, preserved: preservedCols } =
    matchColumns(
      orig.loadedFile!.headers,
      anon.loadedFile!.headers,
      orig.loadedFile!.rows as Record<string, string | number>[],
      anon.loadedFile!.rows as Record<string, string | number>[],
    );

  // For QI diff we still use exact names (QIs are stored as exact column names)
  const origQIs = new Set(or.quasiIdentifiers);
  const anonQIs = new Set(ar.quasiIdentifiers);
  const removedQIs = or.quasiIdentifiers.filter(q => !anonQIs.has(q));
  const newQIs     = ar.quasiIdentifiers.filter(q => !origQIs.has(q));
  const sharedQIs  = or.quasiIdentifiers.filter(q => anonQIs.has(q));

  const origBadge = riskBadge(or.reIdRisk);
  const anonBadge = riskBadge(ar.reIdRisk);

  const riskReduced     = ar.reIdRisk < or.reIdRisk;
  const overallImproved = riskReduced && ar.uniqueRecordsCount <= or.uniqueRecordsCount;

  const radarData = [
    { metric: "Re-ID Risk",      orig: parseFloat((or.reIdRisk * 100).toFixed(1)),       anon: parseFloat((ar.reIdRisk * 100).toFixed(1)) },
    { metric: "Uniqueness Rate", orig: parseFloat((or.uniquenessRate * 100).toFixed(1)), anon: parseFloat((ar.uniquenessRate * 100).toFixed(1)) },
    { metric: "High-Risk Rate",  orig: parseFloat((or.highRiskRate * 100).toFixed(1)),   anon: parseFloat((ar.highRiskRate * 100).toFixed(1)) },
  ];

  const barData = [
    { name: "Re-ID Risk %",      Original: parseFloat((or.reIdRisk * 100).toFixed(1)),       Anonymized: parseFloat((ar.reIdRisk * 100).toFixed(1)) },
    { name: "Unique Records %",  Original: parseFloat((or.uniquenessRate * 100).toFixed(1)), Anonymized: parseFloat((ar.uniquenessRate * 100).toFixed(1)) },
    { name: "At-Risk Records %", Original: parseFloat((or.highRiskRate * 100).toFixed(1)),   Anonymized: parseFloat((ar.highRiskRate * 100).toFixed(1)) },
  ];

  const metricRows = [
    { label: "Re-ID Risk",         desc: "Average attacker success rate",              orig: pct(or.reIdRisk),                                        anon: pct(ar.reIdRisk),                                        delta: <Delta orig={or.reIdRisk}        anon={ar.reIdRisk}        lowerIsBetter />,                                    better: ar.reIdRisk < or.reIdRisk },
    { label: "Unique Records",     desc: "Singletons (k=1) — 100% identifiable",       orig: or.uniqueRecordsCount.toLocaleString(),                  anon: ar.uniqueRecordsCount.toLocaleString(),                  delta: <Delta orig={or.uniqueRecordsCount} anon={ar.uniqueRecordsCount} lowerIsBetter fmt={v => v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`} />, better: ar.uniqueRecordsCount < or.uniqueRecordsCount },
    { label: "At-Risk Records",    desc: "Records in groups smaller than k",           orig: `${or.atRiskCount.toLocaleString()} (${pct(or.highRiskRate)})`,  anon: `${ar.atRiskCount.toLocaleString()} (${pct(ar.highRiskRate)})`,  delta: <Delta orig={or.highRiskRate}    anon={ar.highRiskRate}    lowerIsBetter />,                                    better: ar.atRiskCount < or.atRiskCount },
    { label: "Protected Records",  desc: "Records meeting k-anonymity threshold",      orig: `${or.protectedCount.toLocaleString()} (${pct(1 - or.highRiskRate)})`, anon: `${ar.protectedCount.toLocaleString()} (${pct(1 - ar.highRiskRate)})`, delta: <Delta orig={1 - or.highRiskRate} anon={1 - ar.highRiskRate} lowerIsBetter={false} />,               better: ar.protectedCount > or.protectedCount },
    { label: "Avg EC Size",        desc: "Mean group size sharing same QI values",    orig: or.avgEcSize.toFixed(2),                                 anon: ar.avgEcSize.toFixed(2),                                 delta: <Delta orig={or.avgEcSize}       anon={ar.avgEcSize}       lowerIsBetter={false} fmt={v => v.toFixed(2)} />,          better: ar.avgEcSize > or.avgEcSize },
    { label: "Min-K",              desc: "Smallest group size (worst-case exposure)",  orig: or.minK.toString(),                                     anon: ar.minK.toString(),                                     delta: <Delta orig={or.minK}            anon={ar.minK}            lowerIsBetter={false} fmt={v => v.toFixed(0)} />,          better: ar.minK > or.minK },
    { label: "Uniqueness Rate",    desc: "Fraction of records that are singletons",   orig: pct(or.uniquenessRate),                                 anon: pct(ar.uniquenessRate),                                 delta: <Delta orig={or.uniquenessRate}  anon={ar.uniquenessRate}  lowerIsBetter />,                                    better: ar.uniquenessRate < or.uniquenessRate },
  ];

  const improvements = metricRows.filter(r => r.better).length;
  const regressions  = metricRows.filter(r => !r.better).length;

  return (
    <div className="space-y-8">

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">⚖️</span>
            <h1 className="text-2xl font-bold text-black">Dataset Comparison</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Side-by-side privacy risk comparison between original and anonymized datasets</p>
        </div>
      </div>

      {/* Overall verdict banner */}
      <div className={`border rounded-xl p-5 flex items-center gap-4 flex-wrap ${overallImproved ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${overallImproved ? "bg-green-600" : "bg-amber-500"}`}>
          {overallImproved ? <CheckCircle className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-bold text-base ${overallImproved ? "text-green-800" : "text-amber-800"}`}>
            {overallImproved ? "✅ Anonymization Effective — Privacy risk is reduced" : "⚠️ Anonymization Needs Review — Risk metrics have not improved sufficiently"}
          </p>
          <p className={`text-sm mt-0.5 ${overallImproved ? "text-green-700" : "text-amber-700"}`}>
            {improvements} metric{improvements !== 1 ? "s" : ""} improved · {regressions} regression{regressions !== 1 ? "s" : ""} detected ·{" "}
            Re-ID risk changed from <strong>{pct(or.reIdRisk)}</strong> → <strong>{pct(ar.reIdRisk)}</strong>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Original</p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${origBadge.cls}`}>{origBadge.label} RISK</span>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Anonymized</p>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${anonBadge.cls}`}>{anonBadge.label} RISK</span>
          </div>
        </div>
      </div>

      {/* ── Column Analysis ──────────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-black">Column Analysis</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Columns are matched case-insensitively — renamed columns like <code className="bg-gray-100 px-1 rounded text-xs">Survey_Name → survey_name</code> are detected as the same column
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-4 divide-x divide-gray-200 border-b border-gray-200 text-center text-sm">
          {[
            { count: suppressedCols.length,  label: "Suppressed",  icon: "🗑",  bg: "bg-red-50",    text: "text-red-700"   },
            { count: anonymizedCols.length,  label: "Anonymized",  icon: "🔄",  bg: "bg-amber-50",  text: "text-amber-700" },
            { count: preservedCols.length,   label: "Preserved",   icon: "✓",   bg: "bg-gray-50",   text: "text-gray-600"  },
            { count: addedCols.length,       label: "Added",       icon: "➕",  bg: "bg-teal-50",   text: "text-teal-700"  },
          ].map(({ count, label, icon, bg, text }) => (
            <div key={label} className={`py-3 px-4 ${bg}`}>
              <p className={`text-xl font-black ${text}`}>{count}</p>
              <p className={`text-xs font-semibold ${text}`}>{icon} {label}</p>
            </div>
          ))}
        </div>

        <div className="p-6 space-y-5">

          {/* Anonymized columns — most important, shown first */}
          {anonymizedCols.length > 0 && (
            <div className="border border-amber-200 rounded-xl overflow-hidden">
              <div className="bg-amber-50 px-4 py-3 border-b border-amber-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-900">🔄 Anonymized Columns</p>
                  <p className="text-xs text-amber-700 mt-0.5">Columns that exist in both datasets but were renamed or had their values modified</p>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex-shrink-0">{anonymizedCols.length} columns</span>
              </div>
              <div className="divide-y divide-amber-100">
                {anonymizedCols.map(col => (
                  <div key={col.origName} className="px-4 py-3 flex flex-wrap items-start gap-3 bg-white hover:bg-amber-50/40 transition-colors">
                    {/* Column name mapping */}
                    <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                      <code className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-100">{col.origName}</code>
                      {col.renamed && (
                        <>
                          <ArrowRight className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <code className="font-mono text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-100">{col.anonName}</code>
                        </>
                      )}
                    </div>
                    {/* Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {col.renamed && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">Renamed</span>
                      )}
                      {col.valuesChanged && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">Values Modified</span>
                      )}
                    </div>
                    {/* Value previews */}
                    {col.valuesChanged && (
                      <div className="flex items-start gap-4 text-xs text-gray-500 flex-1 min-w-0 mt-0.5 flex-wrap">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-semibold text-blue-600 flex-shrink-0">Before:</span>
                          <span className="truncate">{col.sampleOrigVals.map(v => `"${v}"`).join(", ")}{col.origUniques > 4 ? ` +${col.origUniques - 4} more` : ""}</span>
                        </div>
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-semibold text-purple-600 flex-shrink-0">After:</span>
                          <span className="truncate">{col.sampleAnonVals.map(v => `"${v}"`).join(", ")}{col.anonUniques > 4 ? ` +${col.anonUniques - 4} more` : ""}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-gray-400">{col.origUniques} → {col.anonUniques} unique values</span>
                          {col.anonUniques < col.origUniques && (
                            <span className="text-green-600 font-semibold">(generalized)</span>
                          )}
                          {col.anonUniques > col.origUniques && (
                            <span className="text-amber-600 font-semibold">(expanded)</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom 3 panels side by side */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

            {/* Suppressed */}
            <div className="border border-red-200 rounded-xl overflow-hidden">
              <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-red-800">🗑 Suppressed / Removed</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{suppressedCols.length}</span>
              </div>
              <div className="p-3 space-y-1.5 min-h-[80px] max-h-64 overflow-y-auto">
                {suppressedCols.length === 0
                  ? <p className="text-xs text-gray-400 text-center py-4">No columns removed</p>
                  : suppressedCols.map(c => (
                    <div key={c} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100">
                      <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                      <span className="font-mono text-xs text-red-800 truncate">{c}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Preserved */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">✓ Preserved (Unchanged)</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{preservedCols.length}</span>
              </div>
              <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto min-h-[80px]">
                {preservedCols.length === 0
                  ? <p className="text-xs text-gray-400 text-center py-4">No columns preserved as-is</p>
                  : preservedCols.map(col => {
                    const isQI = origQIs.has(col.origName) || anonQIs.has(col.anonName);
                    return (
                      <div key={col.origName} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-100">
                        <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                        <span className="font-mono text-xs text-gray-700 truncate flex-1">{col.origName}</span>
                        {isQI && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold flex-shrink-0">QI</span>}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Added */}
            <div className="border border-teal-200 rounded-xl overflow-hidden">
              <div className="bg-teal-50 px-4 py-3 border-b border-teal-200 flex items-center justify-between">
                <p className="text-sm font-semibold text-teal-800">➕ Added / New</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">{addedCols.length}</span>
              </div>
              <div className="p-3 space-y-1.5 min-h-[80px] max-h-64 overflow-y-auto">
                {addedCols.length === 0
                  ? <p className="text-xs text-gray-400 text-center py-4">No new columns added</p>
                  : addedCols.map(c => (
                    <div key={c} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100">
                      <span className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0" />
                      <span className="font-mono text-xs text-teal-800 truncate">{c}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {/* QI treatment diff */}
        {(removedQIs.length > 0 || newQIs.length > 0) && (
          <div className="border-t border-gray-200 px-6 py-4 bg-amber-50/50">
            <p className="text-sm font-semibold text-amber-900 mb-3">⚠️ Quasi-Identifier Treatment Changed</p>
            <div className="flex flex-wrap gap-3">
              {removedQIs.map(q => (
                <div key={q} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs">
                  <span className="font-mono font-semibold text-black">{q}</span>
                  <span className="text-gray-400">was QI in original</span>
                  <ArrowRight className="w-3 h-3 text-amber-500" />
                  <span className="text-amber-700 font-semibold">removed from QIs</span>
                </div>
              ))}
              {newQIs.map(q => (
                <div key={q} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-purple-300 text-xs">
                  <span className="font-mono font-semibold text-black">{q}</span>
                  <span className="text-gray-400">not a QI in original</span>
                  <ArrowRight className="w-3 h-3 text-purple-500" />
                  <span className="text-purple-700 font-semibold">added as QI</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {sharedQIs.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-3 bg-gray-50/60">
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">Same QIs analysed in both:</span>{" "}
              {sharedQIs.map(q => <code key={q} className="mx-0.5 px-1 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{q}</code>)}
            </p>
          </div>
        )}
      </div>

      {/* ── Metrics comparison table ─────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-black">Privacy Metrics Comparison</h2>
          <p className="text-sm text-gray-500 mt-0.5">Key re-identification risk metrics side by side</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">Metric</th>
                <th className="px-5 py-3 text-center font-semibold text-blue-600 text-xs uppercase tracking-wide">📄 Original</th>
                <th className="px-5 py-3 text-center font-semibold text-purple-600 text-xs uppercase tracking-wide">🔒 Anonymized</th>
                <th className="px-5 py-3 text-center font-semibold text-gray-500 text-xs uppercase tracking-wide">Change</th>
                <th className="px-5 py-3 text-center font-semibold text-gray-500 text-xs uppercase tracking-wide">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map((row, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-black text-sm">{row.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{row.desc}</p>
                  </td>
                  <td className="px-5 py-3.5 text-center font-mono font-bold text-blue-700">{row.orig}</td>
                  <td className="px-5 py-3.5 text-center font-mono font-bold text-purple-700">{row.anon}</td>
                  <td className="px-5 py-3.5 text-center">{row.delta}</td>
                  <td className="px-5 py-3.5 text-center">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${row.better ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {row.better ? "✓ Better" : "✗ Worse"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
          <div>
            <p className="font-semibold text-black text-sm">Risk Metrics — Side by Side</p>
            <p className="text-xs text-gray-400 mt-0.5">Lower values are better for all three metrics</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ bottom: 10 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v) => [`${v}%`]} />
              <Legend />
              <Bar dataKey="Original" fill="#2563EB" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Anonymized" fill="#7C3AED" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
          <div>
            <p className="font-semibold text-black text-sm">Risk Profile Radar</p>
            <p className="text-xs text-gray-400 mt-0.5">Smaller polygon = better privacy protection</p>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
              <Radar name="Original" dataKey="orig" stroke="#2563EB" fill="#2563EB" fillOpacity={0.25} />
              <Radar name="Anonymized" dataKey="anon" stroke="#7C3AED" fill="#7C3AED" fillOpacity={0.25} />
              <Legend />
              <Tooltip formatter={(v) => [`${v}%`]} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── EC Size Distribution comparison ──────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-black">Equivalence Class Distribution</h2>
          <p className="text-sm text-gray-500 mt-0.5">How records are distributed across group sizes — larger groups = better privacy</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-5 py-3 text-left font-semibold text-gray-500 text-xs uppercase tracking-wide">EC Size</th>
                <th className="px-5 py-3 text-center font-semibold text-blue-600 text-xs uppercase tracking-wide">📄 Orig Records</th>
                <th className="px-5 py-3 text-center font-semibold text-blue-600 text-xs uppercase tracking-wide">Orig %</th>
                <th className="px-5 py-3 text-center font-semibold text-purple-600 text-xs uppercase tracking-wide">🔒 Anon Records</th>
                <th className="px-5 py-3 text-center font-semibold text-purple-600 text-xs uppercase tracking-wide">Anon %</th>
                <th className="px-5 py-3 text-center font-semibold text-gray-500 text-xs uppercase tracking-wide">Change</th>
              </tr>
            </thead>
            <tbody>
              {or.ecSizeTable.map((oRow, i) => {
                const aRow = ar.ecSizeTable[i];
                const origPctNum = parseFloat(oRow.pct);
                const anonPctNum = aRow ? parseFloat(aRow.pct) : 0;
                const isRiskyBucket = i === 0;
                const improved = isRiskyBucket ? anonPctNum < origPctNum : anonPctNum > origPctNum;
                const diff = anonPctNum - origPctNum;
                return (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <span className={`text-sm font-semibold ${isRiskyBucket ? "text-red-700" : "text-gray-800"}`}>{oRow.label}</span>
                    </td>
                    <td className="px-5 py-3 text-center font-mono text-blue-700">{oRow.numRecords.toLocaleString()}</td>
                    <td className="px-5 py-3 text-center font-mono text-blue-600">{oRow.pct}</td>
                    <td className="px-5 py-3 text-center font-mono text-purple-700">{aRow?.numRecords.toLocaleString() ?? "—"}</td>
                    <td className="px-5 py-3 text-center font-mono text-purple-600">{aRow?.pct ?? "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${improved ? "text-green-600" : diff === 0 ? "text-gray-400" : "text-red-600"}`}>
                        {diff > 0 ? <TrendingUp className="w-3 h-3" /> : diff < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {diff > 0 ? "+" : ""}{diff.toFixed(1)}pp
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── L-Diversity / T-Closeness ────────────────────────────────────────── */}
      {(or.lDiversityResults.length > 0 || ar.lDiversityResults.length > 0) && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
            <h2 className="text-base font-semibold text-black">L-Diversity &amp; T-Closeness Comparison</h2>
            <p className="text-sm text-gray-500 mt-0.5">Sensitive attribute protection checks in both datasets</p>
          </div>
          <div className="p-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">L-Diversity</p>
              {[{ rows: or.lDiversityResults, label: "📄 Original", cls: "border-blue-200 bg-blue-50/40" }, { rows: ar.lDiversityResults, label: "🔒 Anonymized", cls: "border-purple-200 bg-purple-50/40" }].map(({ rows, label, cls }) => (
                rows.length > 0 && (
                  <div key={label} className={`border rounded-xl overflow-hidden mb-3 ${cls}`}>
                    <div className="px-4 py-2.5 border-b border-inherit"><p className="text-xs font-semibold text-gray-700">{label}</p></div>
                    <div className="divide-y divide-inherit">
                      {rows.map(r => (
                        <div key={r.sa} className="px-4 py-2.5 flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-gray-700 truncate flex-1">{r.sa}</span>
                          <span className="text-xs text-gray-500">Min-L: {r.minL}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.status === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">T-Closeness</p>
              {[{ rows: or.tClosenessResults, label: "📄 Original", cls: "border-blue-200 bg-blue-50/40" }, { rows: ar.tClosenessResults, label: "🔒 Anonymized", cls: "border-purple-200 bg-purple-50/40" }].map(({ rows, label, cls }) => (
                rows.length > 0 && (
                  <div key={label} className={`border rounded-xl overflow-hidden mb-3 ${cls}`}>
                    <div className="px-4 py-2.5 border-b border-inherit"><p className="text-xs font-semibold text-gray-700">{label}</p></div>
                    <div className="divide-y divide-inherit">
                      {rows.map(r => (
                        <div key={r.sa} className="px-4 py-2.5 flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-gray-700 truncate flex-1">{r.sa}</span>
                          <span className="text-xs text-gray-500">Max TVD: {r.maxDistance.toFixed(3)}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.status === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary ──────────────────────────────────────────────────────────── */}
      <div className="border border-teal-200 rounded-2xl overflow-hidden bg-teal-50/30">
        <div className="bg-teal-50 border-b border-teal-200 px-6 py-4">
          <h2 className="text-base font-semibold text-black">Comparison Summary &amp; Recommendations</h2>
          <p className="text-sm text-gray-500 mt-0.5">What the anonymization achieved and what still needs attention</p>
        </div>
        <div className="p-6 space-y-3">
          {anonymizedCols.length > 0 && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">✅</span>
              <span className="text-gray-700">
                <strong>{anonymizedCols.length} column{anonymizedCols.length !== 1 ? "s" : ""} anonymized</strong> in the privacy-protected dataset:{" "}
                {anonymizedCols.map(c => <code key={c.origName} className="mx-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">{c.origName}</code>)}.
                {" "}Their values or names were modified to reduce re-identification risk.
              </span>
            </div>
          )}
          {suppressedCols.length > 0 && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">✅</span>
              <span className="text-gray-700"><strong>{suppressedCols.length} column{suppressedCols.length !== 1 ? "s" : ""} suppressed</strong> entirely from the anonymized dataset: {suppressedCols.map(c => <code key={c} className="mx-0.5 px-1 py-0.5 rounded bg-red-100 text-red-800 text-xs">{c}</code>)}. This eliminates those attack vectors.</span>
            </div>
          )}
          {riskReduced && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">✅</span>
              <span className="text-gray-700"><strong>Re-ID risk reduced</strong> from <strong className="text-blue-700">{pct(or.reIdRisk)}</strong> to <strong className="text-purple-700">{pct(ar.reIdRisk)}</strong> — a {pct(Math.abs(ar.reIdRisk - or.reIdRisk))} improvement.</span>
            </div>
          )}
          {ar.uniqueRecordsCount < or.uniqueRecordsCount && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">✅</span>
              <span className="text-gray-700"><strong>Singleton records reduced</strong> from <strong className="text-blue-700">{or.uniqueRecordsCount.toLocaleString()}</strong> to <strong className="text-purple-700">{ar.uniqueRecordsCount.toLocaleString()}</strong>.</span>
            </div>
          )}
          {ar.minK > or.minK && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">✅</span>
              <span className="text-gray-700"><strong>Min-K improved</strong> from <strong className="text-blue-700">{or.minK}</strong> to <strong className="text-purple-700">{ar.minK}</strong>.</span>
            </div>
          )}
          {!riskReduced && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">⚠️</span>
              <span className="text-gray-700"><strong>Re-ID risk did not decrease</strong> ({pct(or.reIdRisk)} → {pct(ar.reIdRisk)}). Consider applying stronger k-anonymisation or generalizing more QI columns.</span>
            </div>
          )}
          {ar.uniqueRecordsCount >= or.uniqueRecordsCount && or.uniqueRecordsCount > 0 && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">⚠️</span>
              <span className="text-gray-700"><strong>Singleton records not reduced</strong> — the anonymized dataset still has <strong>{ar.uniqueRecordsCount.toLocaleString()}</strong> unique individuals. Suppress or generalise these rows before release.</span>
            </div>
          )}
          {ar.reIdRisk <= 0.05 && ar.uniqueRecordsCount === 0 && (
            <div className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex-shrink-0">🎉</span>
              <span className="text-gray-700"><strong>Dataset is ready for release.</strong> Re-ID risk is below 5% and no singleton records remain.</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
