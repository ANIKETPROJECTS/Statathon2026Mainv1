export type ColumnType = "numeric" | "text" | "boolean" | "date" | "mixed";

export interface ValueFrequency {
  value: string;
  count: number;
  percent: number;
}

export interface ColumnProfile {
  name: string;
  index: number;
  type: ColumnType;
  totalCount: number;
  nonNullCount: number;
  nullCount: number;
  fillRate: number;
  uniqueCount: number;
  uniqueRate: number;
  sampleValues: string[];
  topValues: ValueFrequency[];
  // Numeric only
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  stdDev?: number;
  // Text only
  minLength?: number;
  maxLength?: number;
  avgLength?: number;
}

export interface DataProfile {
  fileName: string;
  totalRows: number;
  totalColumns: number;
  fileSize?: number;
  columns: ColumnProfile[];
  previewRows: Record<string, string>[];
}

function detectType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v !== "" && v !== null && v !== undefined);
  if (nonEmpty.length === 0) return "text";

  const sample = nonEmpty.slice(0, Math.min(100, nonEmpty.length));

  const numericCount = sample.filter((v) => !isNaN(Number(v)) && v.trim() !== "").length;
  if (numericCount / sample.length > 0.9) return "numeric";

  const boolValues = new Set(["true", "false", "yes", "no", "1", "0", "y", "n"]);
  const boolCount = sample.filter((v) => boolValues.has(v.toLowerCase())).length;
  if (boolCount / sample.length > 0.9) return "boolean";

  const dateCount = sample.filter((v) => {
    const d = new Date(v);
    return !isNaN(d.getTime()) && v.length > 5;
  }).length;
  if (dateCount / sample.length > 0.8) return "date";

  return "text";
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values: number[], mean: number): number {
  const sq = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
  return Math.sqrt(sq / values.length);
}

export function profileColumn(
  name: string,
  index: number,
  rawValues: string[]
): ColumnProfile {
  const totalCount = rawValues.length;
  const nonNullValues = rawValues.filter((v) => v !== "" && v !== null && v !== undefined);
  const nonNullCount = nonNullValues.length;
  const nullCount = totalCount - nonNullCount;
  const fillRate = totalCount > 0 ? (nonNullCount / totalCount) * 100 : 0;

  const type = detectType(nonNullValues);

  const freqMap = new Map<string, number>();
  for (const v of nonNullValues) {
    freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
  }
  const uniqueCount = freqMap.size;
  const uniqueRate = nonNullCount > 0 ? (uniqueCount / nonNullCount) * 100 : 0;

  const topValues: ValueFrequency[] = Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({
      value,
      count,
      percent: nonNullCount > 0 ? (count / nonNullCount) * 100 : 0,
    }));

  const sampleValues = Array.from(new Set(nonNullValues.slice(0, 5)));

  const profile: ColumnProfile = {
    name,
    index,
    type,
    totalCount,
    nonNullCount,
    nullCount,
    fillRate,
    uniqueCount,
    uniqueRate,
    sampleValues,
    topValues,
  };

  if (type === "numeric") {
    const nums = nonNullValues.map(Number).filter((n) => !isNaN(n));
    if (nums.length > 0) {
      const sorted = [...nums].sort((a, b) => a - b);
      const meanVal = nums.reduce((a, b) => a + b, 0) / nums.length;
      profile.min = sorted[0];
      profile.max = sorted[sorted.length - 1];
      profile.mean = meanVal;
      profile.median = median(sorted);
      profile.stdDev = stdDev(nums, meanVal);
    }
  }

  if (type === "text" || type === "mixed") {
    const lengths = nonNullValues.map((v) => v.length);
    if (lengths.length > 0) {
      profile.minLength = lengths.reduce((a, b) => (b < a ? b : a));
      profile.maxLength = lengths.reduce((a, b) => (b > a ? b : a));
      profile.avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    }
  }

  return profile;
}

export function profileData(
  data: Record<string, string>[],
  headers: string[],
  fileName: string,
  fileSize?: number
): DataProfile {
  const columns = headers.map((name, index) => {
    const values = data.map((row) => row[name] ?? "");
    return profileColumn(name, index, values);
  });

  return {
    fileName,
    totalRows: data.length,
    totalColumns: headers.length,
    fileSize,
    columns,
    previewRows: data.slice(0, 100),
  };
}

export function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(decimals);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
