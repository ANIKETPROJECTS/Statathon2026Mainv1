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
  /**
   * true  = this column is a QUESTIONNAIRE variable (recorded by enumerator on the paper form).
   *         Sec/Item/Col should be filled — highlighted in yellow if still empty.
   * false = FRAME variable or SYSTEM-GENERATED variable.
   *         Sec/Item/Col intentionally blank.
   */
  isQuestionnaire: boolean;
  // Field width
  length: number;
  byteStart: number;
  byteEnd: number;
  remarks: string;
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
// Normalise a column name for dictionary lookup:
// strips all non-alphanumeric characters and lowercases.
// "Sample_SU_No" → "samplesuno", "Sample SU No." → "samplesuno"
// ---------------------------------------------------------------------------
export function normalizeColName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// FRAME / SYSTEM variable vocabulary (Rule 2 & 3)
// These are NEVER questionnaire fields — Sec/Item/Col always blank.
// ---------------------------------------------------------------------------
const FRAME_VARS = new Set([
  // Sampling frame identifiers
  "surveyname", "year",
  "fsuserialno", "fsuno", "fsuserial", "fsuserialnum",
  "sector", "state", "district",
  "nssregion", "nssreg", "region",
  "stratum", "substratum", "substratumno",
  "panel", "subsample", "subsmpl",
  "fodsubregion", "fodsubregionno", "fod",
  // System-generated metadata
  "level", "questionnaireno", "questionnairenum",
  "multiplier", "weight", "wgt",
]);

function isFrameOrSystemVar(normalizedName: string): boolean {
  if (FRAME_VARS.has(normalizedName)) return true;
  // Partial-match guard for multiplier/weight-like names
  if (
    normalizedName.includes("multiplier") ||
    normalizedName.includes("weight") ||
    normalizedName.includes("grossing")
  ) return true;
  return false;
}

// ---------------------------------------------------------------------------
// NSSO / HCES Questionnaire Reference Dictionary  (Rule 4)
// Maps normalised column name → { sec, item, col }
// Source: Layout_HCES_2023-24.xlsx — official NSSO questionnaire.
// Only QUESTIONNAIRE variables appear here (not frame/system variables).
// ---------------------------------------------------------------------------
interface QRef { sec: string; item: string; col: string }

export const HCES_QREF: Record<string, QRef> = {
  // ── Level 01 — Section 1 ─────────────────────────────────────────────────
  "samplesuno":                    { sec: "1", item: "1.7",  col: "" },
  "samplesurveyunitno":            { sec: "1", item: "1.7",  col: "" },
  "samplesurveyunit":              { sec: "1", item: "1.7",  col: "" },
  "samplesubdivisionno":           { sec: "1", item: "1.10", col: "" },
  "samplesubdivno":                { sec: "1", item: "1.10", col: "" },
  "samplesubdivision":             { sec: "1", item: "1.10", col: "" },
  "secondstagestratum":            { sec: "1", item: "1.11", col: "" },
  "secondstagestraumno":           { sec: "1", item: "1.11", col: "" },
  "secondstagestratumno":          { sec: "1", item: "1.11", col: "" },
  "samplehouseholdno":             { sec: "1", item: "1.12", col: "" },
  "samplehhldno":                  { sec: "1", item: "1.12", col: "" },
  "samplehhno":                    { sec: "1", item: "1.12", col: "" },
  "surveycode":                    { sec: "1", item: "1.13", col: "" },
  "reasonforsubstitutioncode":     { sec: "1", item: "1.14", col: "" },
  "reasonforsubstitution":         { sec: "1", item: "1.14", col: "" },
  "reasonsubstitution":            { sec: "1", item: "1.14", col: "" },
  "reasonforsubcode":              { sec: "1", item: "1.14", col: "" },

  // ── Level 02 — Section 3 (Household characteristics) ────────────────────
  "religion":                      { sec: "3", item: "3.1",  col: "" },
  "socialgroup":                   { sec: "3", item: "3.2",  col: "" },
  "castecategory":                 { sec: "3", item: "3.2",  col: "" },
  "householdsize":                 { sec: "3", item: "3.3",  col: "" },
  "hhsize":                        { sec: "3", item: "3.3",  col: "" },
  "nopersons":                     { sec: "3", item: "3.3",  col: "" },
  "principalincomesource":         { sec: "3", item: "3.4",  col: "" },
  "principalsourceofincome":       { sec: "3", item: "3.4",  col: "" },
  "principalincome":               { sec: "3", item: "3.4",  col: "" },
  "nhh":                           { sec: "3", item: "3.5",  col: "" },
  "numberofhouseholds":            { sec: "3", item: "3.5",  col: "" },
  "landpossession":                { sec: "3", item: "3.6",  col: "" },
  "landpossessed":                 { sec: "3", item: "3.6",  col: "" },

  // ── Level 03 — Section 4 (Demographic particulars) ───────────────────────
  "memberserialno":                { sec: "4", item: "4.1",  col: "" },
  "memberno":                      { sec: "4", item: "4.1",  col: "" },
  "relation":                      { sec: "4", item: "4.2",  col: "" },
  "relationtohh":                  { sec: "4", item: "4.2",  col: "" },
  "relationtohead":                { sec: "4", item: "4.2",  col: "" },
  "gender":                        { sec: "4", item: "4.3",  col: "" },
  "sex":                           { sec: "4", item: "4.3",  col: "" },
  "age":                           { sec: "4", item: "4.4",  col: "" },
  "ageyears":                      { sec: "4", item: "4.4",  col: "" },
  "maritalstatus":                 { sec: "4", item: "4.5",  col: "" },
  "educationlevel":                { sec: "4", item: "4.6",  col: "" },
  "generaleducation":              { sec: "4", item: "4.6",  col: "" },
  "technicaltraining":             { sec: "4", item: "4.7",  col: "" },
  "activitycode":                  { sec: "4", item: "4.8",  col: "" },
  "principalactivity":             { sec: "4", item: "4.8",  col: "" },
  "activitystatus":                { sec: "4", item: "4.8",  col: "" },
  "industrycode":                  { sec: "4", item: "4.9",  col: "" },
  "ncocode":                       { sec: "4", item: "4.10", col: "" },
  "occupationcode":                { sec: "4", item: "4.10", col: "" },
  "typeofjob":                     { sec: "4", item: "4.11", col: "" },
  "employmentstatus":              { sec: "4", item: "4.11", col: "" },
};

/**
 * Merge user-supplied mapping (Option B companion file) into the built-in dict.
 * Returns a combined lookup object.
 */
export type UserQRefMap = Record<string, QRef>;

function resolveQRef(
  normalizedName: string,
  userMap: UserQRefMap
): QRef {
  // User-supplied mapping takes priority over built-in dictionary
  if (userMap[normalizedName]) return userMap[normalizedName];
  if (HCES_QREF[normalizedName]) return HCES_QREF[normalizedName];
  return { sec: "", item: "", col: "" };
}

// ---------------------------------------------------------------------------
// detectType
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

// ---------------------------------------------------------------------------
// Remarks inference
// ---------------------------------------------------------------------------
const MULTIPLIER_KEYWORDS = ["multiplier", "weight", "wgt", "wt", "factor", "grossing"];

function isMultiplierColumn(name: string, isLast: boolean): boolean {
  const lower = name.toLowerCase();
  if (MULTIPLIER_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (isLast && lower.includes("mult")) return true;
  return false;
}

function isCommonIdColumn(name: string): boolean {
  const lower = name.toLowerCase().replace(/[_\-\s]/g, "");
  return ["serial", "fsu", "ssu", "psu", "household", "hh"].some((kw) => lower.includes(kw));
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
  if (nullRate > 0.8) return "Blank when not applicable";
  if (nullCount > 0 && uniqueCount <= 5) return "If not selected blank generated";
  return "";
}

// ---------------------------------------------------------------------------
// computeTopValues — returns true uniqueCount from the full frequency map
// ---------------------------------------------------------------------------
interface FreqResult { topValues: ValueFrequency[]; uniqueCount: number }

function computeTopValues(nonNullValues: string[], limit = 10): FreqResult {
  const freqMap = new Map<string, number>();
  for (const v of nonNullValues) freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
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
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Main profiling function
// ---------------------------------------------------------------------------
export function profileData(
  data: Record<string, string>[],
  headers: string[],
  fileName: string,
  fileSize?: number,
  userQRefMap: UserQRefMap = {}
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

    // Multiplier columns → forced 15 bytes (NSSO convention)
    let fieldWidth = 1;
    if (isMultiplierColumn(name, isLast) && type === "numeric") {
      fieldWidth = 15;
    } else {
      for (const v of rawValues) {
        if (v.length > fieldWidth) fieldWidth = v.length;
      }
    }

    const sampleValues = Array.from(new Set(nonNullValues.slice(0, 5)));
    const remarks = inferRemarks(name, nonNullValues, topValues, type, nullCount, uniqueCount, totalCount, isLast);

    const norm = normalizeColName(name);

    // ── Determine variable kind ──────────────────────────────────────────
    // Rule 1: exactly 1 unique value → system-generated → NOT questionnaire
    // Rule 2: frame/system vocabulary → NOT questionnaire
    // Rule 3: multiplier/weight → NOT questionnaire
    // Rule 4: everything else → questionnaire variable
    const isSystemGenerated = uniqueCount === 1 && nonNullValues.length > 0;
    const isFrame = isFrameOrSystemVar(norm);
    const isMult = isMultiplierColumn(name, isLast);
    const isQuestionnaire = !isSystemGenerated && !isFrame && !isMult;

    // Resolve Sec / Item / Col
    let qref: QRef = { sec: "", item: "", col: "" };
    if (isQuestionnaire) {
      qref = resolveQRef(norm, userQRefMap);
    }

    const col: ColumnLayout = {
      srlNo: i + 1,
      name,
      qSec: qref.sec,
      qItem: qref.item,
      qCol: qref.col,
      isQuestionnaire,
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

// ---------------------------------------------------------------------------
// Parse a user-supplied mapping file (Option B)
// Accepts JSON: { "Column_Name": { "sec": "1", "item": "1.7", "col": "" } }
// OR CSV with header: column_name,sec,item,col
// ---------------------------------------------------------------------------
export function parseMappingFile(text: string): UserQRefMap {
  const trimmed = text.trim();
  // JSON path
  if (trimmed.startsWith("{")) {
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      const result: UserQRefMap = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === "object") {
          const obj = v as Record<string, string>;
          result[normalizeColName(k)] = {
            sec: obj.sec ?? obj.Sec ?? "",
            item: obj.item ?? obj.Item ?? "",
            col: obj.col ?? obj.Col ?? "",
          };
        }
      }
      return result;
    } catch {
      return {};
    }
  }
  // CSV path: column_name,sec,item,col
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const result: UserQRefMap = {};
  const start = lines[0]?.toLowerCase().includes("column") ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const colName = (parts[0] ?? "").trim();
    if (!colName) continue;
    result[normalizeColName(colName)] = {
      sec:  (parts[1] ?? "").trim(),
      item: (parts[2] ?? "").trim(),
      col:  (parts[3] ?? "").trim(),
    };
  }
  return result;
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
