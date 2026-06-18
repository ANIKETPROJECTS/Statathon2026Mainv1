// ── Types ─────────────────────────────────────────────────────────────────────

export type DataRow = Record<string, string | number>;
export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface EquivalenceClass {
  key: string;
  records: DataRow[];
  size: number;
}

export interface ProsecutorRecordRow {
  rowIdx: number;
  qiValues: Record<string, string>;
  ecSize: number;
  linkScore: number;
  atRisk: boolean;
}

export interface ProsecutorLDivResult {
  sa: string;
  minL: number;
  violatingEcs: number;
  totalEcs: number;
  violatingRecordPct: number;
  status: "PASS" | "FAIL";
}

export interface ProsecutorTCloseResult {
  sa: string;
  maxDistance: number;
  violatingEcs: number;
  totalEcs: number;
  status: "PASS" | "FAIL";
}

export interface ProsecutorResult {
  riskScore: number;
  riskLevel: RiskLevel;
  uniquenessRate: number;
  highRiskRate: number;
  avgEcSize: number;
  minK: number;
  uniqueRecordsCount: number;
  histogram: { label: string; count: number; risk: number }[];
  linkScoreDistribution: { bucket: string; count: number }[];
  topVulnerable: {
    qiCombo: string;
    qiValues: Record<string, string>;
    linkScore: number;
    ecSize: number;
    reason: string;
  }[];
  recommendations: string[];
  equivalenceClasses: EquivalenceClass[];
  totalRecords: number;
  sampleN: number;
  reIdRisk: number;
  atRiskCount: number;
  protectedCount: number;
  quasiIdentifiers: string[];
  recordTable: ProsecutorRecordRow[];
  ecSizeTable: { label: string; numECs: number; numRecords: number; pct: string }[];
  lDiversityResults: ProsecutorLDivResult[];
  tClosenessResults: ProsecutorTCloseResult[];
  topVulnerableRecord: ProsecutorRecordRow | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return "CRITICAL";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}

export function buildEquivalenceClasses(
  data: DataRow[],
  quasiIdentifiers: string[]
): EquivalenceClass[] {
  const ecMap = new Map<string, EquivalenceClass>();
  data.forEach(row => {
    const key = quasiIdentifiers.map(qi => String(row[qi] ?? "")).join("|");
    if (!ecMap.has(key)) ecMap.set(key, { key, records: [], size: 0 });
    const ec = ecMap.get(key)!;
    ec.records.push(row);
    ec.size++;
  });
  return Array.from(ecMap.values());
}

export function sampleData(data: DataRow[], pct: number): DataRow[] {
  if (pct >= 100) return data;
  const n = Math.max(1, Math.round(data.length * pct / 100));
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function emptyResult(quasiIdentifiers: string[]): ProsecutorResult {
  return {
    riskScore: 0, riskLevel: "LOW", uniquenessRate: 0, highRiskRate: 0,
    avgEcSize: 0, minK: 0, uniqueRecordsCount: 0, histogram: [],
    linkScoreDistribution: [], topVulnerable: [], recommendations: [],
    equivalenceClasses: [], totalRecords: 0, sampleN: 0, reIdRisk: 0,
    atRiskCount: 0, protectedCount: 0, quasiIdentifiers,
    recordTable: [], ecSizeTable: [], lDiversityResults: [],
    tClosenessResults: [], topVulnerableRecord: null,
  };
}

// ── Main algorithm ────────────────────────────────────────────────────────────

export function runProsecutorAttack(
  data: DataRow[],
  quasiIdentifiers: string[],
  kThreshold = 5,
  sensitiveAttributes: string[] = [],
  lThreshold = 3,
  tThreshold = 0.2,
): ProsecutorResult {
  if (data.length === 0 || quasiIdentifiers.length === 0) {
    return emptyResult(quasiIdentifiers);
  }

  const n = data.length;

  // Step 1 — Build EC map
  const ecMap = new Map<string, number[]>();
  data.forEach((row, idx) => {
    const key = quasiIdentifiers.map(qi => String(row[qi] ?? "")).join("|");
    const existing = ecMap.get(key);
    if (existing) existing.push(idx);
    else ecMap.set(key, [idx]);
  });

  // Step 2 — Per-record link scores
  const ecSizeArr: number[] = new Array(n);
  ecMap.forEach(indices => {
    const sz = indices.length;
    indices.forEach(i => { ecSizeArr[i] = sz; });
  });

  let totalLinkScore = 0;
  const recordTable: ProsecutorRecordRow[] = data.map((row, idx) => {
    const sz = ecSizeArr[idx];
    const ls = 1 / sz;
    totalLinkScore += ls;
    const qiValues: Record<string, string> = {};
    quasiIdentifiers.forEach(qi => { qiValues[qi] = String(row[qi] ?? ""); });
    return {
      rowIdx: idx + 1,
      qiValues,
      ecSize: sz,
      linkScore: parseFloat(ls.toFixed(4)),
      atRisk: sz < kThreshold,
    };
  });

  // Step 3 — Aggregate metrics
  const reIdRisk = totalLinkScore / n;
  const uniqueRecordsCount = Array.from(ecMap.values()).filter(v => v.length === 1).length;
  const atRiskCount = recordTable.filter(r => r.atRisk).length;
  const protectedCount = n - atRiskCount;
  const uniquenessRate = uniqueRecordsCount / n;
  const highRiskRate = atRiskCount / n;
  const avgEcSize = n / ecMap.size;
  const minK = Math.min(...Array.from(ecMap.values()).map(v => v.length));

  // Build EC objects for use below
  const ecs: EquivalenceClass[] = [];
  ecMap.forEach((indices, key) => {
    ecs.push({ key, records: indices.map(i => data[i]), size: indices.length });
  });

  // Step 4 — EC size histogram
  const buckets = [
    { label: "1 (Unique)", min: 1, max: 1 },
    { label: "2–4", min: 2, max: 4 },
    { label: "5–10", min: 5, max: 10 },
    { label: "11–20", min: 11, max: 20 },
    { label: ">20", min: 21, max: Infinity },
  ];
  const histogram = buckets.map(b => {
    const matching = ecs.filter(ec => ec.size >= b.min && ec.size <= b.max);
    const count = matching.reduce((s, ec) => s + ec.size, 0);
    const avgRisk = matching.length > 0
      ? matching.reduce((s, ec) => s + 1 / ec.size, 0) / matching.length
      : 0;
    return { label: b.label, count, risk: parseFloat((avgRisk * 100).toFixed(1)) };
  });

  // Step 5 — EC size table
  const ecSizeTable = buckets.map(b => {
    const matchingEcs = ecs.filter(ec => ec.size >= b.min && ec.size <= b.max);
    const numRecords = matchingEcs.reduce((s, ec) => s + ec.size, 0);
    return {
      label: b.label,
      numECs: matchingEcs.length,
      numRecords,
      pct: n > 0 ? ((numRecords / n) * 100).toFixed(1) + "%" : "0%",
    };
  });

  // Step 6 — Link score distribution
  const scoreBuckets = [
    { bucket: "1.00 (certain)", min: 1.0, max: 1.0 },
    { bucket: "0.51–0.99 (high)", min: 0.51, max: 0.999 },
    { bucket: "0.26–0.50 (med)", min: 0.26, max: 0.50 },
    { bucket: "0.01–0.25 (low)", min: 0.01, max: 0.25 },
    { bucket: "0.00 (safe)", min: 0.0, max: 0.0 },
  ];
  const linkScoreDistribution = scoreBuckets.map(({ bucket, min, max }) => {
    const count = recordTable.filter(r => {
      if (min === max) return Math.abs(r.linkScore - min) < 0.0001;
      return r.linkScore >= min && r.linkScore <= max;
    }).length;
    return { bucket, count };
  });

  // Step 7 — Top 10 most vulnerable
  const sortedByRisk = [...recordTable].sort((a, b) => b.linkScore - a.linkScore);
  const top10 = sortedByRisk.slice(0, 10);
  const topVulnerable = top10.map(r => ({
    qiCombo: quasiIdentifiers.map(qi => `${qi}=${r.qiValues[qi]}`).join(", "),
    qiValues: r.qiValues,
    linkScore: r.linkScore,
    ecSize: r.ecSize,
    reason: r.ecSize === 1
      ? "Singleton — no look-alike"
      : `EC size ${r.ecSize} < k=${kThreshold}`,
  }));
  const topVulnerableRecord = top10[0] ?? null;

  // Step 8 — L-Diversity
  const lDiversityResults: ProsecutorLDivResult[] = sensitiveAttributes.map(sa => {
    let minL = Infinity;
    let violatingEcs = 0;
    let violatingRecords = 0;
    ecMap.forEach(indices => {
      const vals = new Set<string>();
      indices.forEach(i => vals.add(String(data[i][sa] ?? "")));
      const distinct = vals.size;
      if (distinct < minL) minL = distinct;
      if (distinct < lThreshold) {
        violatingEcs++;
        violatingRecords += indices.length;
      }
    });
    if (!isFinite(minL)) minL = 0;
    return {
      sa, minL, violatingEcs,
      totalEcs: ecMap.size,
      violatingRecordPct: parseFloat(((violatingRecords / n) * 100).toFixed(1)),
      status: violatingEcs === 0 ? "PASS" : "FAIL",
    };
  });

  // Step 9 — T-Closeness
  const tClosenessResults: ProsecutorTCloseResult[] = sensitiveAttributes.map(sa => {
    const globalCounts = new Map<string, number>();
    data.forEach(row => {
      const v = String(row[sa] ?? "");
      globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1);
    });
    const globalDist: Record<string, number> = {};
    globalCounts.forEach((count, v) => { globalDist[v] = count / n; });
    const allValues = Array.from(globalCounts.keys());

    let maxDistance = 0;
    let violatingEcs = 0;
    ecMap.forEach(indices => {
      const localCounts = new Map<string, number>();
      indices.forEach(i => {
        const v = String(data[i][sa] ?? "");
        localCounts.set(v, (localCounts.get(v) ?? 0) + 1);
      });
      const sz = indices.length;
      let tvd = 0;
      allValues.forEach(v => {
        const lp = (localCounts.get(v) ?? 0) / sz;
        const gp = globalDist[v] ?? 0;
        tvd += Math.abs(lp - gp);
      });
      tvd = tvd / 2;
      if (tvd > maxDistance) maxDistance = tvd;
      if (tvd > tThreshold) violatingEcs++;
    });
    return {
      sa,
      maxDistance: parseFloat(maxDistance.toFixed(4)),
      violatingEcs,
      totalEcs: ecMap.size,
      status: violatingEcs === 0 ? "PASS" : "FAIL",
    };
  });

  // Step 10 — Recommendations
  const recommendations: string[] = [];
  const topQI = quasiIdentifiers[0] ?? "QI";
  if (uniqueRecordsCount > 0) {
    recommendations.push(
      `🔴 CRITICAL — ${uniqueRecordsCount} singleton record(s) found. Suppress these rows before release, OR generalize ${topQI} using range brackets.`
    );
  }
  if (reIdRisk > 0.2) {
    recommendations.push(
      `🔴 HIGH — Re-ID risk is ${(reIdRisk * 100).toFixed(1)}% (threshold: <5%). Apply k-anonymisation to bring Min-K up to at least ${kThreshold}.`
    );
  } else if (reIdRisk > 0.05) {
    recommendations.push(
      `🟡 MEDIUM — Re-ID risk ${(reIdRisk * 100).toFixed(1)}% is above 5% safe threshold. Consider additional generalisation.`
    );
  }
  lDiversityResults.filter(r => r.status === "FAIL").forEach(r => {
    recommendations.push(
      `🟡 MEDIUM — L-Diversity violated for "${r.sa}" (${r.violatingEcs}/${r.totalEcs} ECs fail). Ensure each group has ≥${lThreshold} distinct ${r.sa} values.`
    );
  });
  tClosenessResults.filter(r => r.status === "FAIL").forEach(r => {
    recommendations.push(
      `🟡 MEDIUM — T-Closeness violated for "${r.sa}" (max distance ${r.maxDistance} > ${tThreshold}). Distribution differs too much from global.`
    );
  });
  if (recommendations.length === 0) {
    recommendations.push(
      `✅ Prosecutor attack risk is within acceptable bounds (Re-ID: ${(reIdRisk * 100).toFixed(1)}%, Min-K: ${minK} ≥ ${kThreshold}).`
    );
  }
  recommendations.push(
    `ℹ️ NEXT STEP — Apply k-anonymisation or suppression to reduce Re-ID risk, then re-run this assessment to verify improvement.`
  );

  const riskLevel = getRiskLevel(reIdRisk);

  return {
    riskScore: reIdRisk,
    riskLevel,
    uniquenessRate,
    highRiskRate,
    avgEcSize,
    minK,
    uniqueRecordsCount,
    histogram,
    linkScoreDistribution,
    topVulnerable,
    recommendations,
    equivalenceClasses: ecs,
    totalRecords: n,
    sampleN: n,
    reIdRisk,
    atRiskCount,
    protectedCount,
    quasiIdentifiers,
    recordTable,
    ecSizeTable,
    lDiversityResults,
    tClosenessResults,
    topVulnerableRecord,
  };
}

// ── CSV download ──────────────────────────────────────────────────────────────

export function downloadRecordCSV(r: ProsecutorResult) {
  const qis = r.quasiIdentifiers;
  const header = ["Row#", ...qis, "EC_Size", "Link_Score", "Status"].join(",");
  const rows = r.recordTable.map(row => {
    const st = row.linkScore === 1.0
      ? "UNIQUELY_IDENTIFIABLE"
      : row.atRisk ? "LOW_PROTECTION" : "PROTECTED";
    return [row.rowIdx, ...qis.map(qi => `"${row.qiValues[qi] ?? ""}"`), row.ecSize, row.linkScore, st].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "prosecutor_attack_record_level.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV parser ────────────────────────────────────────────────────────────────

export function parseCSVToRows(text: string): { headers: string[]; rows: DataRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  const headers = parseLine(lines[0]);
  const rows: DataRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    if (cells.length === 0) continue;
    const row: DataRow = {};
    headers.forEach((h, j) => { row[h] = cells[j] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}
