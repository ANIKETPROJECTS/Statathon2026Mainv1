import { useState, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Shield, Upload, Play, Download, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, Search, X, FileText, Info,
} from "lucide-react";
import {
  runProsecutorAttack, parseCSVToRows, downloadRecordCSV, sampleData,
  type ProsecutorResult, type DataRow,
} from "@/lib/prosecutor-attack";

// ── Colors ────────────────────────────────────────────────────────────────────

const BUCKET_COLORS = ["#DC2626", "#EA580C", "#D97706", "#2563EB", "#16A34A"];
const LINK_COLORS   = ["#DC2626", "#EA580C", "#D97706", "#2563EB", "#16A34A"];

function riskColor(reIdRisk: number) {
  if (reIdRisk > 0.2) return { border: "border-red-300", bg: "bg-red-50", text: "text-red-700", badge: "bg-red-100 text-red-800", label: "HIGH" };
  if (reIdRisk > 0.05) return { border: "border-amber-300", bg: "bg-amber-50", text: "text-amber-700", badge: "bg-amber-100 text-amber-800", label: "MEDIUM" };
  return { border: "border-green-300", bg: "bg-green-50", text: "text-green-700", badge: "bg-green-100 text-green-800", label: "LOW" };
}

function linkScoreColor(ls: number) {
  if (ls >= 0.5) return "text-red-600 font-bold";
  if (ls >= 0.2) return "text-amber-600 font-semibold";
  return "text-green-600";
}

function statusLabel(atRisk: boolean, linkScore: number, k: number, ecSize: number) {
  if (linkScore === 1.0) return { label: "🔴 UNIQUELY IDENTIFIABLE", cls: "text-red-700 font-bold text-xs" };
  if (atRisk) return { label: `🟠 LOW PROTECTION (k=${ecSize}<${k})`, cls: "text-orange-600 text-xs" };
  return { label: "🟢 PROTECTED", cls: "text-green-700 text-xs" };
}

// ── CSV parser helper ─────────────────────────────────────────────────────────

function triggerBlobDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FileLabel = "original" | "anonymized";

interface LoadedFile {
  name: string;
  label: FileLabel;
  headers: string[];
  rows: DataRow[];
}

export default function RiskAssessment() {
  const inputRef = useRef<HTMLInputElement>(null);

  // File state
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [fileLabel, setFileLabel] = useState<FileLabel>("original");
  const [fileError, setFileError] = useState("");

  // Config state
  const [selectedQIs, setSelectedQIs] = useState<string[]>([]);
  const [selectedSAs, setSelectedSAs] = useState<string[]>([]);
  const [kThreshold, setKThreshold] = useState(5);
  const [lThreshold, setLThreshold] = useState(3);
  const [tThreshold, setTThreshold] = useState(0.2);
  const [samplePct, setSamplePct] = useState(100);

  // Run state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProsecutorResult | null>(null);

  // Result view state
  const [filterMode, setFilterMode] = useState<"all" | "risk" | "protected">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setFileError("");
    setResult(null);
    setSelectedQIs([]);
    setSelectedSAs([]);
    try {
      const text = await file.text();
      const { headers, rows } = parseCSVToRows(text);
      if (headers.length === 0) { setFileError("Could not read CSV headers."); return; }
      setLoadedFile({ name: file.name, label: fileLabel, headers, rows });
    } catch (e) {
      setFileError(`Read error: ${(e as Error).message}`);
    }
  }, [fileLabel]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  // ── Run analysis ───────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    if (!loadedFile || selectedQIs.length === 0) return;
    setRunning(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 20));
    const data = sampleData(loadedFile.rows, samplePct);
    const res = runProsecutorAttack(data, selectedQIs, kThreshold, selectedSAs, lThreshold, tThreshold);
    setResult(res);
    setPage(0);
    setFilterMode("all");
    setSearch("");
    setRunning(false);
  };

  // ── Filtered record table ──────────────────────────────────────────────────

  const filteredRows = result ? result.recordTable.filter(r => {
    if (filterMode === "risk" && !r.atRisk) return false;
    if (filterMode === "protected" && r.atRisk) return false;
    if (search) {
      const q = search.toLowerCase();
      return Object.values(r.qiValues).some(v => v.toLowerCase().includes(q));
    }
    return true;
  }) : [];
  const pageCount = Math.ceil(filteredRows.length / PAGE_SIZE);
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Download full report JSON ──────────────────────────────────────────────

  const downloadSummaryReport = () => {
    if (!result) return;
    const report = {
      file: loadedFile?.name,
      fileType: loadedFile?.label,
      analysedAt: new Date().toISOString(),
      quasiIdentifiers: result.quasiIdentifiers,
      sensitiveAttributes: selectedSAs,
      kThreshold, lThreshold, tThreshold, samplePct,
      summary: {
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        reIdRisk: result.reIdRisk,
        uniqueRecordsCount: result.uniqueRecordsCount,
        avgEcSize: result.avgEcSize,
        minK: result.minK,
        totalRecords: result.totalRecords,
        atRiskCount: result.atRiskCount,
        protectedCount: result.protectedCount,
      },
      ecSizeTable: result.ecSizeTable,
      lDiversityResults: result.lDiversityResults,
      tClosenessResults: result.tClosenessResults,
      recommendations: result.recommendations,
    };
    triggerBlobDownload(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `prosecutor_attack_report_${new Date().toISOString().slice(0, 10)}.json`
    );
  };

  // ── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Always-mounted hidden file input */}
      <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onInputChange} />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-black">Risk Assessment</h1>
          <p className="text-sm text-gray-500 mt-0.5">Evaluate re-identification risk using formal privacy attack models</p>
        </div>
      </div>

      {/* Attack Scenarios panel */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-black">Attack Scenarios</h2>
          <p className="text-sm text-gray-500 mt-0.5">Select an attack model to evaluate</p>
        </div>

        {/* Prosecutor Attack card */}
        <div className="p-6 space-y-6">
          <div className="border border-indigo-200 rounded-xl overflow-hidden bg-indigo-50/30">
            <div className="px-5 py-4 bg-white border-b border-indigo-100 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-black text-sm">Prosecutor Attack</p>
                <p className="text-xs text-gray-500 mt-0.5">NISTIR 8053 · Worst-case re-identification risk</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700">Active</span>
            </div>

            <div className="p-5 space-y-6">

              {/* ── Step A: Upload file ─────────────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-sm font-semibold text-black">1 — Upload dataset for analysis</p>
                <div className="flex gap-3 flex-wrap">
                  {(["original", "anonymized"] as FileLabel[]).map(lbl => (
                    <label key={lbl} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium transition-colors ${fileLabel === lbl ? "border-indigo-500 bg-indigo-50 text-indigo-800" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                      <input type="radio" className="accent-indigo-600" checked={fileLabel === lbl} onChange={() => setFileLabel(lbl)} />
                      {lbl === "original" ? "📄 Original CSV" : "🔒 Anonymized CSV"}
                    </label>
                  ))}
                </div>

                {!loadedFile ? (
                  <div
                    className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
                    <Upload className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-black">Drop CSV here or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">Upload your original or anonymized CSV file</p>
                    <span className="mt-3 inline-block text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-500 font-medium">Browse</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-gray-200">
                    <FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-black truncate">{loadedFile.name}</p>
                      <p className="text-xs text-gray-500">{loadedFile.rows.length.toLocaleString()} records · {loadedFile.headers.length} columns · {loadedFile.label}</p>
                    </div>
                    <button onClick={() => { setLoadedFile(null); setResult(null); setSelectedQIs([]); setSelectedSAs([]); }}
                      className="text-gray-400 hover:text-black flex-shrink-0"><X className="w-4 h-4" /></button>
                    <button onClick={() => inputRef.current?.click()}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-black hover:border-gray-400 transition-colors whitespace-nowrap flex-shrink-0">
                      Change file
                    </button>
                  </div>
                )}
                {fileError && (
                  <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />{fileError}
                  </div>
                )}
              </div>

              {/* ── Step B: Configure columns ───────────────────────────────── */}
              {loadedFile && (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-black">2 — Select columns</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* QI selector */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Quasi-Identifiers <span className="text-red-500">*</span></p>
                        <span className="text-xs text-gray-400">(columns that can identify a person)</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {loadedFile.headers.map(h => (
                          <label key={h} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${selectedQIs.includes(h) ? "border-indigo-400 bg-indigo-50 text-black" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                            <input type="checkbox" className="accent-indigo-600"
                              checked={selectedQIs.includes(h)}
                              onChange={e => {
                                setSelectedQIs(prev => e.target.checked ? [...prev, h] : prev.filter(x => x !== h));
                                setSelectedSAs(prev => prev.filter(x => x !== h));
                              }} />
                            <span className="font-mono text-xs font-medium truncate">{h}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400">{selectedQIs.length} selected</p>
                    </div>

                    {/* SA selector */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Sensitive Attributes</p>
                        <span className="text-xs text-gray-400">(optional — for L/T checks)</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {loadedFile.headers.filter(h => !selectedQIs.includes(h)).map(h => (
                          <label key={h} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${selectedSAs.includes(h) ? "border-purple-400 bg-purple-50 text-black" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                            <input type="checkbox" className="accent-purple-600"
                              checked={selectedSAs.includes(h)}
                              onChange={e => setSelectedSAs(prev => e.target.checked ? [...prev, h] : prev.filter(x => x !== h))} />
                            <span className="font-mono text-xs font-medium truncate">{h}</span>
                          </label>
                        ))}
                        {loadedFile.headers.filter(h => !selectedQIs.includes(h)).length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-2">Select QIs first to see remaining columns</p>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{selectedSAs.length} selected</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step C: Parameters ─────────────────────────────────────── */}
              {loadedFile && (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-black">3 — Parameters</p>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {[
                      { label: "k-Threshold", desc: "Min EC size", val: kThreshold, set: setKThreshold, min: 2, max: 50, step: 1, fmt: (v: number) => v.toString() },
                      { label: "l-Threshold", desc: "Min distinct SA", val: lThreshold, set: setLThreshold, min: 2, max: 20, step: 1, fmt: (v: number) => v.toString() },
                      { label: "t-Threshold", desc: "Max TVD", val: tThreshold, set: setTThreshold, min: 0.05, max: 1, step: 0.05, fmt: (v: number) => v.toFixed(2) },
                      { label: "Sample %", desc: "Rows to analyse", val: samplePct, set: setSamplePct, min: 1, max: 100, step: 1, fmt: (v: number) => v + "%" },
                    ].map(({ label, desc, val, set, min, max, step, fmt }) => (
                      <div key={label} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-700">{label}</p>
                          <span className="text-xs font-mono font-bold text-indigo-700">{fmt(val)}</span>
                        </div>
                        <input type="range" min={min} max={max} step={step} value={val}
                          onChange={e => set(Number(e.target.value))}
                          className="w-full accent-indigo-600" />
                        <p className="text-xs text-gray-400">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Run button ──────────────────────────────────────────────── */}
              {loadedFile && (
                <button
                  onClick={runAnalysis}
                  disabled={running || selectedQIs.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {running
                    ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running analysis…</>
                    : <><Play className="w-4 h-4" />Run Prosecutor Attack</>}
                </button>
              )}
            </div>
          </div>

          {/* ── Results ─────────────────────────────────────────────────────── */}
          {result && <ProsecutorReport
            result={result}
            fileLabel={loadedFile?.label ?? "original"}
            kThreshold={kThreshold}
            filterMode={filterMode} setFilterMode={setFilterMode}
            search={search} setSearch={setSearch}
            page={page} setPage={setPage}
            pageRows={pageRows} pageCount={pageCount} filteredRows={filteredRows}
            downloadSummaryReport={downloadSummaryReport}
          />}
        </div>
      </div>
    </div>
  );
}

// ── ProsecutorReport component ────────────────────────────────────────────────

function ProsecutorReport({
  result, fileLabel, kThreshold,
  filterMode, setFilterMode, search, setSearch,
  page, setPage, pageRows, pageCount, filteredRows,
  downloadSummaryReport,
}: {
  result: ProsecutorResult;
  fileLabel: FileLabel;
  kThreshold: number;
  filterMode: "all" | "risk" | "protected";
  setFilterMode: (v: "all" | "risk" | "protected") => void;
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (v: number) => void;
  pageRows: ReturnType<typeof result.recordTable.slice>;
  pageCount: number;
  filteredRows: typeof result.recordTable;
  downloadSummaryReport: () => void;
}) {
  const rc = riskColor(result.reIdRisk);
  const isSingleton = result.totalRecords > 0 && result.equivalenceClasses.length >= 0.9 * result.totalRecords;

  // §4.1 — Attack Summary Banner
  return (
    <div className="space-y-6 mt-2">

      {/* Download buttons */}
      <div className="flex gap-2 justify-end flex-wrap">
        <button onClick={() => downloadRecordCSV(result)}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:text-black hover:border-gray-400 transition-colors font-medium">
          <Download className="w-4 h-4" />Record-level CSV
        </button>
        <button onClick={downloadSummaryReport}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors font-medium">
          <Download className="w-4 h-4" />Summary Report (JSON)
        </button>
      </div>

      {/* §4.1 Banner */}
      <div className={`border rounded-xl p-5 ${rc.border} ${rc.bg}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <Shield className={`w-6 h-6 ${rc.text} flex-shrink-0`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-base font-bold ${rc.text}`}>🎯 Prosecutor Attack Results</p>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${rc.badge}`}>{rc.label} RISK</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium capitalize">{fileLabel} dataset</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {result.totalRecords.toLocaleString()} rows analysed · {result.quasiIdentifiers.length} quasi-identifier{result.quasiIdentifiers.length !== 1 ? "s" : ""} used
            </p>
          </div>
          <div className={`text-3xl font-black ${rc.text} flex-shrink-0`}>
            {(result.reIdRisk * 100).toFixed(1)}%
          </div>
        </div>
        <p className="text-sm text-gray-700 mt-3">
          An attacker who already knows a person is in this dataset can correctly identify{" "}
          <strong>{(result.reIdRisk * 100).toFixed(1)}%</strong> of individuals using only{" "}
          <em>{result.quasiIdentifiers.join(", ")}</em>. Out of{" "}
          <strong>{result.totalRecords.toLocaleString()}</strong> records,{" "}
          <strong>{result.uniqueRecordsCount.toLocaleString()}</strong>{" "}
          {result.uniqueRecordsCount === 1 ? "person is" : "people are"} completely unique — {result.uniqueRecordsCount === 1 ? "they can" : "each can"} be pinpointed with 100% certainty.
        </p>
      </div>

      {/* §4.2 — 4 KPI Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          {
            title: "Re-ID Risk", value: `${(result.reIdRisk * 100).toFixed(1)}%`,
            sub: "Avg chance attacker correctly IDs a person",
            danger: result.reIdRisk > 0.2,
          },
          {
            title: "Unique Records", value: result.uniqueRecordsCount.toLocaleString(),
            sub: "Singletons — 100% identifiable (k=1)",
            danger: result.uniqueRecordsCount > 0,
          },
          {
            title: "Avg EC Size", value: result.avgEcSize.toFixed(1),
            sub: "Mean group size sharing same QI values",
            danger: result.avgEcSize < kThreshold,
          },
          {
            title: "Min-K", value: result.minK.toString(),
            sub: "Smallest group — worst-case exposure",
            danger: result.minK < kThreshold,
          },
        ].map(({ title, value, sub, danger }) => (
          <div key={title} className="border border-gray-200 rounded-xl p-4 bg-white">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
            <p className={`text-2xl font-black mt-1 ${danger ? "text-red-600" : "text-green-600"}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* §4.3 — Record-level attack trace table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
          <p className="font-semibold text-black text-sm flex-1">Record-Level Attack Trace</p>
          <div className="flex items-center gap-1 text-xs font-semibold flex-wrap">
            {(["all", "risk", "protected"] as const).map(m => (
              <button key={m} onClick={() => { setFilterMode(m); setPage(0); }}
                className={`px-2.5 py-1.5 rounded-lg transition-colors ${filterMode === m ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {m === "all" ? "Show All" : m === "risk" ? "🔴 At Risk" : "🟢 Protected"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-1.5 bg-white">
            <Search className="w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search QI values…"
              className="text-xs outline-none bg-transparent w-32 text-black placeholder-gray-400" />
          </div>
          <button onClick={() => downloadRecordCSV(result)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:text-black hover:border-gray-400 transition-colors whitespace-nowrap">
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left border-b border-gray-200 font-semibold text-gray-500 whitespace-nowrap">Row #</th>
                {result.quasiIdentifiers.map(qi => (
                  <th key={qi} className="px-3 py-2 text-left border-b border-gray-200 font-semibold text-gray-500 whitespace-nowrap">{qi}</th>
                ))}
                <th className="px-3 py-2 text-center border-b border-gray-200 font-semibold text-gray-500 whitespace-nowrap">Group Size</th>
                <th className="px-3 py-2 text-center border-b border-gray-200 font-semibold text-gray-500 whitespace-nowrap">Link Score</th>
                <th className="px-3 py-2 text-left border-b border-gray-200 font-semibold text-gray-500 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const st = statusLabel(r.atRisk, r.linkScore, kThreshold, r.ecSize);
                return (
                  <tr key={r.rowIdx} className={`border-t border-gray-100 hover:bg-gray-50 ${r.linkScore === 1.0 ? "bg-red-50/40" : r.atRisk ? "bg-orange-50/30" : ""}`}>
                    <td className="px-3 py-2 font-mono text-gray-400">{r.rowIdx}</td>
                    {result.quasiIdentifiers.map(qi => (
                      <td key={qi} className="px-3 py-2 text-black">{r.qiValues[qi] ?? ""}</td>
                    ))}
                    <td className="px-3 py-2 text-center font-mono text-black">{r.ecSize}</td>
                    <td className={`px-3 py-2 text-center font-mono ${linkScoreColor(r.linkScore)}`}>{r.linkScore.toFixed(4)}</td>
                    <td className={`px-3 py-2 ${st.cls}`}>{st.label}</td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={result.quasiIdentifiers.length + 4} className="px-4 py-8 text-center text-gray-400 text-sm">No records match the current filter</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
            <span>{filteredRows.length.toLocaleString()} rows · Page {page + 1} of {pageCount}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 transition-colors">← Prev</button>
              <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-40 transition-colors">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* §4.4 — Attack Simulation Narrative */}
      {result.topVulnerableRecord && (
        <div className="border border-orange-200 rounded-xl overflow-hidden bg-orange-50/30">
          <div className="px-5 py-4 bg-orange-50 border-b border-orange-200">
            <p className="font-semibold text-black text-sm">🎯 Attack Simulation Narrative</p>
            <p className="text-xs text-gray-500 mt-0.5">Real-value walkthrough using the most vulnerable record (Row #{result.topVulnerableRecord.rowIdx})</p>
          </div>
          <div className="p-5 font-mono text-xs text-gray-800 space-y-3 leading-relaxed">
            <div className="space-y-1">
              <p className="font-bold text-orange-700">Step 1 — Attacker's Knowledge</p>
              <p className="text-gray-600">  The attacker knows a specific person is in this dataset.</p>
              <p className="text-gray-600">  From a public record they know:</p>
              {Object.entries(result.topVulnerableRecord.qiValues).map(([k, v]) => (
                <p key={k} className="text-gray-800 pl-4">  {k} = <strong>{v}</strong></p>
              ))}
            </div>
            <div className="space-y-1">
              <p className="font-bold text-orange-700">Step 2 — Database Query</p>
              <p className="text-gray-600">  Attacker queries: "Show me all records where</p>
              <p className="text-gray-800 pl-4">  {Object.entries(result.topVulnerableRecord.qiValues).map(([k, v]) => `${k}="${v}"`).join(" AND ")}"</p>
              <p className="text-gray-600">  Result: <strong>{result.topVulnerableRecord.ecSize}</strong> record{result.topVulnerableRecord.ecSize !== 1 ? "s" : ""} found. (Row #{result.topVulnerableRecord.rowIdx})</p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-orange-700">Step 3 — Re-identification</p>
              {result.topVulnerableRecord.ecSize === 1 ? (
                <p className="text-gray-600">  Since only 1 record matches, the attacker has identified<br />  this person with <strong className="text-red-600">100% certainty.</strong></p>
              ) : (
                <p className="text-gray-600">  With {result.topVulnerableRecord.ecSize} records matching, the attacker has a{" "}
                  <strong className="text-orange-600">{(result.topVulnerableRecord.linkScore * 100).toFixed(1)}%</strong> chance of correctly identifying this person.</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="font-bold text-orange-700">Step 4 — Scale</p>
              <p className="text-gray-600">  This attack was possible (link score ≥ 0.5) on{" "}
                <strong>{result.recordTable.filter(r => r.linkScore >= 0.5).length.toLocaleString()}</strong> out of{" "}
                <strong>{result.totalRecords.toLocaleString()}</strong> records.</p>
              <p className="text-gray-600">  <strong>{(result.uniquenessRate * 100).toFixed(1)}%</strong> of your dataset is fully re-identifiable (singleton records).</p>
            </div>
          </div>
        </div>
      )}

      {/* §4.5 — EC Size Distribution */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-3">
          <p className="font-semibold text-black text-sm">EC Size Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={result.histogram} layout="vertical" margin={{ left: 10, right: 20 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={75} />
              <Tooltip formatter={(v) => [`${v} records`, "Count"]} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {result.histogram.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="font-semibold text-black text-xs uppercase tracking-wide">EC Size Breakdown</p>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              {["EC Size", "# ECs", "# Records", "% Dataset"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {result.ecSizeTable.map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-semibold text-black">{row.label}</td>
                  <td className="px-3 py-2 text-gray-700">{row.numECs.toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-700">{row.numRecords.toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-gray-700">{row.pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* §4.6 — Link Score Distribution */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-3">
          <p className="font-semibold text-black text-sm">Link Score Distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={result.linkScoreDistribution} margin={{ bottom: 30 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [`${v} records`, "Count"]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {result.linkScoreDistribution.map((_, i) => <Cell key={i} fill={LINK_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <p className="font-semibold text-black text-xs uppercase tracking-wide">Score Interpretation</p>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              {["Score Range", "# Records", "Meaning"].map(h => (
                <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {[
                { range: "1.00 (certain)", meaning: "Attacker is 100% certain" },
                { range: "0.51–0.99 (high)", meaning: "More likely correct than not" },
                { range: "0.26–0.50 (med)", meaning: "Coin-flip or worse" },
                { range: "0.01–0.25 (low)", meaning: "Attacker has <25% chance" },
                { range: "0.00 (safe)", meaning: "Effectively anonymous" },
              ].map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono font-semibold text-gray-700">{row.range}</td>
                  <td className="px-3 py-2 text-gray-700">{(result.linkScoreDistribution[i]?.count ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-500">{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* §4.7 — L-Diversity */}
      {result.lDiversityResults.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
            <p className="font-semibold text-black text-sm">L-Diversity Check</p>
            <p className="text-xs text-gray-500 mt-0.5">Each equivalence class should have ≥ {result.lDiversityResults.length > 0 ? "l" : "?"} distinct sensitive attribute values</p>
          </div>
          {isSingleton && (
            <div className="mx-5 mt-4 flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Most equivalence classes are singletons. L-Diversity failures are a structural artifact — any group of 1 can only have 1 distinct SA value. The fix is to reduce QI granularity.</span>
            </div>
          )}
          <div className="p-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.lDiversityResults.map(r => (
              <div key={r.sa} className={`border rounded-xl p-4 ${r.status === "PASS" ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-black text-sm font-mono">{r.sa}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.status === "PASS" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {r.status === "PASS" ? "✅ PASS" : "❌ FAIL"}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p>Min distinct values in any EC: <strong>{r.minL}</strong></p>
                  <p>Violating ECs: <strong>{r.violatingEcs}</strong> / {r.totalEcs}</p>
                  <p>Records in violating ECs: <strong>{r.violatingRecordPct}%</strong></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* §4.8 — T-Closeness */}
      {result.tClosenessResults.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
            <p className="font-semibold text-black text-sm">T-Closeness Check (TVD)</p>
            <p className="text-xs text-gray-500 mt-0.5">Sensitive attribute distribution within each EC vs. global dataset distribution</p>
          </div>
          {isSingleton && (
            <div className="mx-5 mt-4 flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Singleton ECs always produce TVD → 1.0 (a single record's distribution is a point mass). These failures are a structural artifact, not evidence of information leakage.</span>
            </div>
          )}
          <div className="p-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {result.tClosenessResults.map(r => (
              <div key={r.sa} className={`border rounded-xl p-4 ${r.status === "PASS" ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-black text-sm font-mono">{r.sa}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.status === "PASS" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                    {r.status === "PASS" ? "✅ PASS" : "❌ FAIL"}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  <p>Max TVD from global distribution: <strong>{r.maxDistance}</strong></p>
                  <p>Violating ECs: <strong>{r.violatingEcs}</strong> / {r.totalEcs}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* §4.9 Donut + §4.10 Top 10 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Donut */}
        <div className="border border-gray-200 rounded-xl p-5 bg-white space-y-2">
          <p className="font-semibold text-black text-sm">Risk–Protection Split</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={[
                  { name: `At Risk (${result.atRiskCount})`, value: result.atRiskCount },
                  { name: `Protected (${result.protectedCount})`, value: result.protectedCount },
                ]}
                cx="50%" cy="50%"
                innerRadius={55} outerRadius={80}
                paddingAngle={2}
                dataKey="value">
                <Cell fill="#DC2626" />
                <Cell fill="#16A34A" />
              </Pie>
              <Legend formatter={(v) => <span className="text-xs">{v}</span>} />
              <Tooltip formatter={(v) => [`${v} records`]} />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 text-center">
            At Risk: {result.atRiskCount.toLocaleString()} ({(result.highRiskRate * 100).toFixed(1)}%) — EC size &lt; k={kThreshold}{" "}
            / Protected: {result.protectedCount.toLocaleString()} ({((result.protectedCount / result.totalRecords) * 100).toFixed(1)}%)
          </p>
        </div>

        {/* Top 10 vulnerable */}
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
            <p className="font-semibold text-black text-sm">Top 10 Most Vulnerable Records</p>
            <p className="text-xs text-gray-500 mt-0.5">These rows should be suppressed or generalized before releasing this dataset.</p>
          </div>
          <div className="overflow-y-auto max-h-[200px]">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">Rank</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500">QI Combination</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-500">Score</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-500">EC Size</th>
                </tr>
              </thead>
              <tbody>
                {result.topVulnerable.map((tv, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-bold text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate" title={tv.qiCombo}>{tv.qiCombo.length > 40 ? tv.qiCombo.slice(0, 40) + "…" : tv.qiCombo}</td>
                    <td className={`px-3 py-2 text-center font-mono font-bold ${linkScoreColor(tv.linkScore)}`}>{tv.linkScore.toFixed(4)}</td>
                    <td className="px-3 py-2 text-center font-mono text-gray-700">{tv.ecSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* §4.11 — Recommendations */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
          <p className="font-semibold text-black text-sm">Recommendations</p>
        </div>
        <ul className="p-5 space-y-2">
          {result.recommendations.map((rec, i) => (
            <li key={i} className="text-sm text-gray-700 leading-relaxed">{rec}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
