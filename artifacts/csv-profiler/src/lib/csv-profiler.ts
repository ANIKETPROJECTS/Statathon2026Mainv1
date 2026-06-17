export type ColumnType = "numeric" | "text" | "boolean" | "date" | "mixed";

export interface ValueFrequency {
  value: string;
  count: number;
  percent: number;
}

export interface ColumnLayout {
  srlNo: number;
  name: string;
  // Questionnaire reference — auto-detected or left blank
  qSec: string;
  qItem: string;
  qCol: string;
  // Field width (max string length of any value in this column)
  length: number;
  // Cumulative byte positions in a fixed-width representation
  byteStart: number;
  byteEnd: number;
  // Auto-inferred remarks
  remarks: string;
  // Extra stats for the detail panel
  type: ColumnType;
  totalCount: number;
  nonNullCount: number;
  nullCount: number;
  fillRate: number;
  uniqueCount: number;
  topValues: ValueFrequency[];
  sampleValues: string[];
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
}

export interface DataProfile {
  fileName: string;
  totalRows: number;
  totalColumns: number;
  fileSize?: number;
  totalRecordLength: number;
  columns: ColumnLayout[];
  previewRows: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// NSSO / HCES Questionnaire Reference Dictionary
// Key = column name normalized to lowercase with all non-alphanumeric chars
// stripped. This lets us match "Sample_SU_No", "Sample SU No.", "sampleSUNo"
// all to the same entry.
// Values from Layout_HCES_2023-24.xlsx — the official NSSO questionnaire.
// ---------------------------------------------------------------------------
interface QRef { sec: string; item: string; col: string }

const HCES_QREF: Record<string, QRef> = {
  // ── Level 01 (Section 1 and 1_1) ──────────────────────────────────────
  "samplesuno":                      { sec: "1", item: "1.7",  col: "" },
  "samplesurveyunitno":              { sec: "1", item: "1.7",  col: "" },
  "samplesurveyunit":                { sec: "1", item: "1.7",  col: "" },
  "samplesubdivisionno":             { sec: "1", item: "1.10", col: "" },
  "samplesubdivno":                  { sec: "1", item: "1.10", col: "" },
  "samplesubdivision":               { sec: "1", item: "1.10", col: "" },
  "secondstagestratum":              { sec: "1", item: "1.11", col: "" },
  "secondstagestraumno":             { sec: "1", item: "1.11", col: "" },
  "secondstageStratumno":            { sec: "1", item: "1.11", col: "" },
  "secondstagestratumno":            { sec: "1", item: "1.11", col: "" },
  "samplehouseholdno":               { sec: "1", item: "1.12", col: "" },
  "samplehhldno":                    { sec: "1", item: "1.12", col: "" },
  "samplehhlno":                     { sec: "1", item: "1.12", col: "" },
  "samplehhno":                      { sec: "1", item: "1.12", col: "" },
  "surveycode":                      { sec: "1", item: "1.13", col: "" },
  "reasonforsubstitutioncode":       { sec: "1", item: "1.14", col: "" },
  "reasonforsubstitution":           { sec: "1", item: "1.14", col: "" },
  "reasonsubstitution":              { sec: "1", item: "1.14", col: "" },
  "reasonforsubcode":                { sec: "1", item: "1.14", col: "" },
  "reasonforsubcodes":               { sec: "1", item: "1.14", col: "" },

  // ── Level 02 (Section 3 — Household characteristics) ──────────────────
  "religion":                        { sec: "3", item: "3.1",  col: "" },
  "socialgroup":                     { sec: "3", item: "3.2",  col: "" },
  "castecategory":                   { sec: "3", item: "3.2",  col: "" },
  "householdsize":                   { sec: "3", item: "3.3",  col: "" },
  "hhsize":                          { sec: "3", item: "3.3",  col: "" },
  "nopersons":                       { sec: "3", item: "3.3",  col: "" },
  "principalincome":                 { sec: "3", item: "3.4",  col: "" },
  "principalsource":                 { sec: "3", item: "3.4",  col: "" },
  "nhh":                             { sec: "3", item: "3.5",  col: "" },
  "numberofhouseholds":              { sec: "3", item: "3.5",  col: "" },
  "landpossession":                  { sec: "3", item: "3.6",  col: "" },
  "landpossessed":                   { sec: "3", item: "3.6",  col: "" },

  // ── Level 03 (Section 4 — Demographic particulars) ────────────────────
  "serialno":                        { sec: "4", item: "4.1",  col: "" },
  "membersno":                       { sec: "4", item: "4.1",  col: "" },
  "relation":                        { sec: "4", item: "4.2",  col: "" },
  "relationtohh":                    { sec: "4", item: "4.2",  col: "" },
  "relationtohead":                  { sec: "4", item: "4.2",  col: "" },
  "gender":                          { sec: "4", item: "4.3",  col: "" },
  "sex":                             { sec: "4", item: "4.3",  col: "" },
  "age":                             { sec: "4", item: "4.4",  col: "" },
  "ageyears":                        { sec: "4", item: "4.4",  col: "" },
  "maritalstatus":                   { sec: "4", item: "4.5",  col: "" },
  "educationlevel":                  { sec: "4", item: "4.6",  col: "" },
  "generaleducation":                { sec: "4", item: "4.6",  col: "" },
  "technicaltraining":               { sec: "4", item: "4.7",  col: "" },
  "activitycode":                    { sec: "4", item: "4.8",  col: "" },
  "principalactivity":               { sec: "4", item: "4.8",  col: "" },
  "activitystatus":                  { sec: "4", item: "4.8",  col: "" },
  "industrycode":                    { sec: "4", item: "4.9",  col: "" },
  "ncocode":                         { sec: "4", item: "4.10", col: "" },
  "occupationcode":                  { sec: "4", item: "4.10", col: "" },
  "typeofjob":                       { sec: "4", item: "4.11", col: "" },
  "employmentstatus":                { sec: "4", item: "4.11", col: "" },
};

function normalizeColName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lookupQRef(name: string): QRef {
  const key = normalizeColName(name);
  return HCES_QREF[key] ?? { sec: "", item: "", col: "" };
}

// ---------------------------------------------------------------------------

function detectType(sample: string[]): ColumnType {
  const nonEmpty = sample.filter((v) => v !== "");
  if (nonEmpty.length === 0) return "text";

  const numericCount = nonEmpty.filter((v) => !isNaN(Number(v)) && v.trim() !== "").length;
  if (numericCount / nonEmpty.length > 0.85) return "numeric";

  const boolValues = new Set(["true", "false", "yes", "no", "1", "0", "y", "n"]);
  const boolCount = nonEmpty.filter((v) => boolValues.has(v.toLowerCase())).length;
  if (boolCount / nonEmpty.length > 0.9) return "boolean";

  const dateCount = nonEmpty.filter((v) => {
    const d = new Date(v);
    return !isNaN(d.getTime()) && v.length > 5;
  }).length;
  if (dateCount / nonEmpty.length > 0.8) return "date";

  return "text";
}

const MULTIPLIER_KEYWORDS = ["multiplier", "weight", "wgt", "wt", "factor", "grossing"];
const COMMON_ID_KEYWORDS = ["serial", "fsu", "ssu", "psu", "household", "hh"];

function isMultiplierColumn(name: string, isLast: boolean): boolean {
  const lower = name.toLowerCase();
  if (MULTIPLIER_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (isLast && lower.includes("mult")) return true;
  return false;
}

function isCommonIdColumn(name: string): boolean {
  const lower = name.toLowerCase().replace(/[_\-\s]/g, "");
  return COMMON_ID_KEYWORDS.some((kw) => lower.includes(kw));
}

function inferRemarks(
  name: string,
  nonNullValues: string[],
  topValues: ValueFrequency[],
  type: ColumnType,
  nullCount: number,
  uniqueCount: number,
  totalCount: number,
  isLast: boolean
): string {
  if (uniqueCount === 1 && nonNullValues.length > 0) {
    const val = topValues[0]?.value ?? "";
    return `'${val}' Generated`;
  }

  if (isMultiplierColumn(name, isLast) && type === "numeric") {
    return "Final weight/multiplier";
  }

  if (isCommonIdColumn(name)) {
    return "**Common-ID**";
  }

  const nullRate = totalCount > 0 ? nullCount / totalCount : 0;
  if (nullRate > 0.8) {
    return "Blank when not applicable";
  }

  if (nullCount > 0 && uniqueCount <= 5) {
    return "If not selected blank generated";
  }

  return "";
}

interface FreqResult {
  topValues: ValueFrequency[];
  uniqueCount: number;
}

function computeTopValues(nonNullValues: string[], limit = 10): FreqResult {
  const freqMap = new Map<string, number>();
  for (const v of nonNullValues) {
    freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
  }
  const uniqueCount = freqMap.size;
  const topValues = Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({
      value,
      count,
      percent: nonNullValues.length > 0 ? (count / nonNullValues.length) * 100 : 0,
    }));
  return { topValues, uniqueCount };
}

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function profileData(
  data: Record<string, string>[],
  headers: string[],
  fileName: string,
  fileSize?: number
): DataProfile {
  let bytePos = 1;
  const columns: ColumnLayout[] = [];

  for (let i = 0; i < headers.length; i++) {
    const name = headers[i];
    const isLast = i === headers.length - 1;
    const rawValues = data.map((row) => row[name] ?? "");
    const nonNullValues = rawValues.filter((v) => v !== "");
    const totalCount = rawValues.length;
    const nullCount = totalCount - nonNullValues.length;
    const fillRate = totalCount > 0 ? (nonNullValues.length / totalCount) * 100 : 0;

    const type = detectType(nonNullValues.slice(0, 200));
    const { topValues, uniqueCount } = computeTopValues(nonNullValues);

    // Multiplier columns always get 15 bytes (NSSO convention)
    let fieldWidth = 1;
    if (isMultiplierColumn(name, isLast) && type === "numeric") {
      fieldWidth = 15;
    } else {
      for (const v of rawValues) {
        if (v.length > fieldWidth) fieldWidth = v.length;
      }
    }

    const sampleValues = Array.from(new Set(nonNullValues.slice(0, 5)));

    const remarks = inferRemarks(
      name, nonNullValues, topValues, type, nullCount, uniqueCount, totalCount, isLast
    );

    // Look up Sec / Item / Col from the NSSO questionnaire dictionary
    const qref = lookupQRef(name);

    const col: ColumnLayout = {
      srlNo: i + 1,
      name,
      qSec: qref.sec,
      qItem: qref.item,
      qCol: qref.col,
      length: fieldWidth,
      byteStart: bytePos,
      byteEnd: bytePos + fieldWidth - 1,
      remarks,
      type,
      totalCount,
      nonNullCount: nonNullValues.length,
      nullCount,
      fillRate,
      uniqueCount,
      topValues,
      sampleValues,
    };

    if (type === "numeric") {
      const nums = nonNullValues.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        const sorted = [...nums].sort((a, b) => a - b);
        col.min = sorted[0];
        col.max = sorted[sorted.length - 1];
        col.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
        col.median = medianOf(sorted);
      }
    }

    columns.push(col);
    bytePos += fieldWidth;
  }

  return {
    fileName,
    totalRows: data.length,
    totalColumns: headers.length,
    fileSize,
    totalRecordLength: bytePos - 1,
    columns,
    previewRows: data.slice(0, 100),
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(decimals);
}
