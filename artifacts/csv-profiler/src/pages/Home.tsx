import { useState, useCallback, useRef } from "react";
import Papa from "papaparse";
import { Upload, FileText, X, BarChart2, Table2, Info, FileJson, CheckCircle2, Download } from "lucide-react";
import { downloadCSV, downloadExcel } from "@/lib/export";
import {
  profileData,
  parseMappingFile,
  type DataProfile,
  type ColumnLayout,
  type UserQRefMap,
  formatFileSize,
} from "@/lib/csv-profiler";
import { ColumnDetailPanel } from "@/components/ColumnDetailPanel";
import { DataPreviewTable } from "@/components/DataPreviewTable";
import { SummaryCards } from "@/components/SummaryCards";
import { ProfileTable } from "@/components/ProfileTable";

type ViewMode = "profile" | "preview";

export default function Home() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<ColumnLayout | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("profile");
  const [error, setError] = useState<string | null>(null);
  const [userQRefMap, setUserQRefMap] = useState<UserQRefMap>({});
  const [mappingFileName, setMappingFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mappingInputRef = useRef<HTMLInputElement>(null);

  // Keep track of the last raw CSV so we can re-profile when mapping changes
  const lastParseRef = useRef<{
    data: Record<string, string>[];
    headers: string[];
    fileName: string;
    fileSize?: number;
  } | null>(null);

  const applyProfile = useCallback(
    (
      data: Record<string, string>[],
      headers: string[],
      fileName: string,
      fileSize: number | undefined,
      qrefMap: UserQRefMap
    ) => {
      const p = profileData(data, headers, fileName, fileSize, qrefMap);
      setProfile(p);
      setSelectedColumn(null);
    },
    []
  );

  const processFile = useCallback(
    (file: File) => {
      const name = file.name.toLowerCase();
      if (!name.endsWith(".csv") && !name.endsWith(".tsv") && file.type !== "text/csv") {
        setError("Please upload a CSV or TSV file.");
        return;
      }
      setError(null);
      setIsLoading(true);
      setProfile(null);
      setSelectedColumn(null);

      const delimiter = name.endsWith(".tsv") ? "\t" : undefined;

      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter,
        complete: (results) => {
          const headers = results.meta.fields ?? [];
          const data = results.data as Record<string, string>[];
          lastParseRef.current = { data, headers, fileName: file.name, fileSize: file.size };
          applyProfile(data, headers, file.name, file.size, userQRefMap);
          setIsLoading(false);
        },
        error: (err) => {
          setError(`Failed to parse file: ${err.message}`);
          setIsLoading(false);
        },
      });
    },
    [applyProfile, userQRefMap]
  );

  const processMappingFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const qrefMap = parseMappingFile(text);
        setUserQRefMap(qrefMap);
        setMappingFileName(file.name);
        // Re-profile if CSV was already loaded
        if (lastParseRef.current) {
          const { data, headers, fileName, fileSize } = lastParseRef.current;
          applyProfile(data, headers, fileName, fileSize, qrefMap);
        }
      };
      reader.readAsText(file);
    },
    [applyProfile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleMappingFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processMappingFile(file);
    e.target.value = "";
  };

  const handleReset = () => {
    setProfile(null);
    setSelectedColumn(null);
    setError(null);
    setViewMode("profile");
    setUserQRefMap({});
    setMappingFileName(null);
    lastParseRef.current = null;
  };

  const handleUpdateQRef = (
    colIndex: number,
    sec: string,
    item: string,
    col: string,
    remarks: string
  ) => {
    if (!profile) return;
    const updated = { ...profile };
    updated.columns = profile.columns.map((c, i) =>
      i === colIndex ? { ...c, qSec: sec, qItem: item, qCol: col, remarks } : c
    );
    setProfile(updated);
    if (selectedColumn && selectedColumn.srlNo === colIndex + 1) {
      setSelectedColumn({ ...selectedColumn, qSec: sec, qItem: item, qCol: col, remarks });
    }
  };

  // Count questionnaire columns that still need Sec/Item filled
  const unfilledQCount = profile
    ? profile.columns.filter((c) => c.isQuestionnaire && !c.qSec).length
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">CSV Data Profiler</h1>
              <p className="text-xs text-muted-foreground">Auto-generate data layout tables from any CSV file</p>
            </div>
          </div>
          {profile && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
              Load new file
            </button>
          )}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Upload area */}
        {!profile && !isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <div
              className={`w-full max-w-2xl border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent/30"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">Drop your CSV file here</h2>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse — supports CSV and TSV files of any size
              </p>
              <div className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg">
                <FileText className="w-4 h-4" />
                Choose file
              </div>
            </div>

            {/* Optional mapping file upload */}
            <div className="mt-4 w-full max-w-2xl">
              <div className="border border-dashed border-border rounded-xl px-5 py-4 flex items-center gap-4 bg-card">
                <FileJson className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">Optional: Questionnaire mapping file</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload a JSON or CSV file to pre-fill Sec / Item / Col for any column.{" "}
                    <span className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
                      {"{ \"Column_Name\": { \"sec\": \"1\", \"item\": \"1.7\", \"col\": \"\" } }"}
                    </span>
                  </p>
                </div>
                <input
                  ref={mappingInputRef}
                  type="file"
                  accept=".json,.csv"
                  className="hidden"
                  onChange={handleMappingFileChange}
                />
                {mappingFileName ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium flex-shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                    {mappingFileName}
                  </div>
                ) : (
                  <button
                    onClick={() => mappingInputRef.current?.click()}
                    className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
                  >
                    Browse
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-4 text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg w-full max-w-2xl">
                {error}
              </div>
            )}

            <div className="mt-8 text-center max-w-xl">
              <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">What this tool generates</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: "📋", label: "Layout table", desc: "Srl. no., Item, Length, Byte positions" },
                  { icon: "📐", label: "Field widths", desc: "Auto-computed from actual data" },
                  { icon: "💬", label: "Remarks", desc: "Auto-inferred from value patterns" },
                ].map((item) => (
                  <div key={item.label} className="bg-card border border-border rounded-xl p-3 text-left">
                    <div className="text-lg mb-1">{item.icon}</div>
                    <div className="text-xs font-medium text-foreground">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Profiling your dataset...</p>
          </div>
        )}

        {/* Results */}
        {profile && (
          <div className="space-y-6">
            {/* File info + mapping upload + view toggle */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{profile.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {profile.totalRows.toLocaleString()} rows &times; {profile.totalColumns} columns
                    {profile.fileSize ? ` · ${formatFileSize(profile.fileSize)}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Mapping file upload inline */}
                <input
                  ref={mappingInputRef}
                  type="file"
                  accept=".json,.csv"
                  className="hidden"
                  onChange={handleMappingFileChange}
                />
                {mappingFileName ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {mappingFileName}
                  </div>
                ) : (
                  <button
                    onClick={() => mappingInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground"
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    Upload mapping file
                  </button>
                )}

                {/* Unfilled questionnaire warning */}
                {unfilledQCount > 0 && (
                  <span className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                    {unfilledQCount} questionnaire {unfilledQCount === 1 ? "column needs" : "columns need"} Sec/Item
                  </span>
                )}

                {/* Download buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => downloadCSV(profile)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-muted-foreground font-medium"
                    title="Download layout table as CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                  <button
                    onClick={() => downloadExcel(profile)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-colors text-emerald-700 font-medium"
                    title="Download layout table as Excel (.xlsx)"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Excel
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  <button
                    onClick={() => setViewMode("profile")}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                      viewMode === "profile"
                        ? "bg-card text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Info className="w-3.5 h-3.5" />
                    Layout Table
                  </button>
                  <button
                    onClick={() => setViewMode("preview")}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                      viewMode === "preview"
                        ? "bg-card text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    Data Preview
                  </button>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <SummaryCards profile={profile} />

            {viewMode === "profile" && (
              <div className={`grid gap-6 ${selectedColumn ? "grid-cols-[1fr_340px]" : "grid-cols-1"}`}>
                <ProfileTable
                  profile={profile}
                  selectedColumn={selectedColumn}
                  onSelectColumn={setSelectedColumn}
                  onUpdateQRef={handleUpdateQRef}
                />
                {selectedColumn && (
                  <ColumnDetailPanel
                    column={selectedColumn}
                    onClose={() => setSelectedColumn(null)}
                  />
                )}
              </div>
            )}

            {viewMode === "preview" && (
              <DataPreviewTable profile={profile} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
