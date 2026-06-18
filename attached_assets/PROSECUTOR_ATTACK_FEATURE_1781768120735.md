# Prosecutor Attack — Complete Feature Documentation

> **System:** Airavata Privacy-Preserving Data Analytics Platform  
> **Module:** Risk Assessment → Prosecutor Attack  
> **Methodology:** NISTIR 8053 — De-Identification of Personal Health Information  
> **Implementation:** Client-side TypeScript (React + Recharts UI)

---

## Table of Contents

1. [Threat Model & Attacker Definition](#1-threat-model--attacker-definition)
2. [Core Concepts & Terminology](#2-core-concepts--terminology)
3. [Mathematical Foundation](#3-mathematical-foundation)
4. [Algorithm — Step-by-Step](#4-algorithm--step-by-step)
5. [Data Structures & TypeScript Interfaces](#5-data-structures--typescript-interfaces)
6. [Input Parameters](#6-input-parameters)
7. [Computation Pipeline (10 Steps)](#7-computation-pipeline-10-steps)
8. [Risk Thresholds & Classification](#8-risk-thresholds--classification)
9. [L-Diversity Sub-Check](#9-l-diversity-sub-check)
10. [T-Closeness Sub-Check (TVD)](#10-t-closeness-sub-check-tvd)
11. [Recommendations Engine](#11-recommendations-engine)
12. [Result UI — All Sections](#12-result-ui--all-sections)
13. [CSV Export](#13-csv-export)
14. [Helper Utilities](#14-helper-utilities)
15. [Full Output Interface Reference](#15-full-output-interface-reference)
16. [Implementation Checklist](#16-implementation-checklist)

---

## 1. Threat Model & Attacker Definition

### Who is the Prosecutor?

The **Prosecutor** is the worst-case adversary model in the NISTIR 8053 framework. The attacker:

| Property | Value |
|---|---|
| **Prior knowledge** | Knows a specific target individual **is** in the dataset |
| **Goal** | Confirm the identity of that individual and learn their sensitive attributes |
| **Resources** | Unlimited time; access to quasi-identifier (QI) values from external sources |
| **Method** | Queries the released dataset using QI combinations to isolate the target record |
| **Success condition** | The query returns exactly 1 matching record (singleton), or a very small group |

### Contrast with Other Attackers

| Attacker | What they know | Re-ID formula |
|---|---|---|
| **Prosecutor** | Target IS in dataset | `1 / EC_size` per record |
| **Journalist** | Target MAY be in dataset | Population estimator (Pitman) |
| **Marketer** | Targets groups, not individuals | Average across all ECs |

The Prosecutor attack is the **upper bound** — if Prosecutor risk is acceptable, all weaker attacks are also acceptable.

---

## 2. Core Concepts & Terminology

### Quasi-Identifier (QI)
A column (or combination of columns) that, when combined, can narrow down records to an individual. Examples: `{age, gender, postcode}`, `{district, occupation, education_level}`.

A QI alone does not uniquely identify someone, but **combinations** do. The analyst selects which columns to treat as QIs before running the assessment.

### Sensitive Attribute (SA)
A column whose value must be kept private — the thing the attacker wants to learn. Examples: `income`, `health_condition`, `religion`, `caste`.

### Equivalence Class (EC)
A group of records that share **identical values** for all selected quasi-identifiers. Formally:

```
EC(r) = { r' ∈ D | ∀ qi ∈ QI : r'[qi] = r[qi] }
```

An EC of size 1 (singleton) means the individual is **uniquely identifiable**.

### k-Anonymity
A dataset satisfies **k-anonymity** if every EC contains at least `k` records.  
`k = 1` → completely identifiable.  
`k ≥ 5` is generally the minimum acceptable threshold.

---

## 3. Mathematical Foundation

### 3.1 Link Score (Per Record)

The probability that an attacker correctly re-identifies a specific record `r`:

```
Link_Score(r) = 1 / |EC(r)|
```

Where `|EC(r)|` is the number of records in the equivalence class containing `r`.

| EC Size | Link Score | Interpretation |
|---|---|---|
| 1 | 1.0000 | 100% — attacker is certain |
| 2 | 0.5000 | Coin flip |
| 4 | 0.2500 | 25% chance |
| 5 | 0.2000 | 20% (meets k=5 threshold) |
| 10 | 0.1000 | 10% chance |
| 20 | 0.0500 | 5% chance |
| 100 | 0.0100 | 1% chance — very safe |

### 3.2 Dataset Re-Identification Risk (Primary Metric)

The **mean link score** across all N records in the sample:

```
Re_ID_Risk = (1/N) × Σ(i=1 to N) [ 1 / |EC(rᵢ)| ]
```

**Mathematical equivalence:** This equals `(number of distinct ECs) / N`

**Proof:**  
Each EC of size `s` contributes `s × (1/s) = 1` to the sum.  
There are `|ECs|` distinct ECs.  
Therefore: `Re_ID_Risk = |ECs| / N`

### 3.3 Uniqueness Rate

Fraction of records that are singletons (EC size = 1):

```
Uniqueness_Rate = Count(|EC(r)| = 1) / N
```

### 3.4 High-Risk Rate

Fraction of records whose EC size is below the k threshold:

```
High_Risk_Rate = Count(|EC(r)| < k) / N
```

### 3.5 Average EC Size

```
Avg_EC_Size = N / |distinct ECs|
```

### 3.6 Minimum K

```
Min_K = min over all ECs { |EC| }
```

This is the **worst single record** in the dataset.

### 3.7 Risk Level Classification

```
if   Re_ID_Risk ≥ 0.70  → CRITICAL
elif Re_ID_Risk ≥ 0.50  → HIGH
elif Re_ID_Risk ≥ 0.30  → MEDIUM
else                    → LOW
```

Additional UI-level thresholds (for banner color coding):

```
if   Re_ID_Risk > 0.20  → RED banner   (HIGH risk label)
elif Re_ID_Risk > 0.05  → AMBER banner (MEDIUM risk label)
else                    → GREEN banner (LOW risk label)
```

---

## 4. Algorithm — Step-by-Step

### High-Level Flow

```
Input: dataset rows, quasi-identifiers[], k_threshold, sensitive_attributes[], l_threshold, t_threshold
  │
  ├── Step 1: Build EC map (key → [row indices])
  ├── Step 2: Assign link scores to every record
  ├── Step 3: Compute aggregate metrics (Re_ID_Risk, Min_K, etc.)
  ├── Step 4: Generate EC size histogram (5 buckets)
  ├── Step 5: Build EC size table (numeric breakdown)
  ├── Step 6: Compute link score distribution (5 risk bands)
  ├── Step 7: Identify top 10 most vulnerable records
  ├── Step 8: L-Diversity check per sensitive attribute
  ├── Step 9: T-Closeness check per sensitive attribute (TVD)
  └── Step 10: Generate conditional recommendations
Output: ProsecutorResult object
```

---

## 5. Data Structures & TypeScript Interfaces

### 5.1 Input Types

```typescript
type DataRow = Record<string, string | number>;

// Each DataRow is one row from the uploaded dataset.
// Keys are column names; values are the cell values.
```

### 5.2 Equivalence Class

```typescript
interface EquivalenceClass {
  key: string;       // pipe-joined QI values, e.g. "Male|25|Mumbai"
  records: DataRow[];
  size: number;
}
```

### 5.3 Per-Record Row (Record Table)

```typescript
interface ProsecutorRecordRow {
  rowIdx: number;                     // 1-based row number
  qiValues: Record<string, string>;   // { gender: "Male", age: "25", ... }
  ecSize: number;                     // how many records share these QI values
  linkScore: number;                  // 1 / ecSize, rounded to 4 decimal places
  atRisk: boolean;                    // true if ecSize < kThreshold
}
```

### 5.4 L-Diversity Result (per sensitive attribute)

```typescript
interface ProsecutorLDivResult {
  sa: string;                   // sensitive attribute column name
  minL: number;                 // smallest distinct SA count found in any EC
  violatingEcs: number;         // ECs where distinct SA count < lThreshold
  totalEcs: number;             // total number of ECs
  violatingRecordPct: number;   // % of records in violating ECs
  status: "PASS" | "FAIL";
}
```

### 5.5 T-Closeness Result (per sensitive attribute)

```typescript
interface ProsecutorTCloseResult {
  sa: string;             // sensitive attribute column name
  maxDistance: number;    // worst-case Total Variation Distance across all ECs
  violatingEcs: number;   // ECs where TVD > tThreshold
  totalEcs: number;       // total number of ECs
  status: "PASS" | "FAIL";
}
```

### 5.6 Full Result Object

```typescript
interface ProsecutorResult {
  // ── Core backward-compatible fields ──────────────────────────────────────
  riskScore: number;           // alias for reIdRisk (0.0–1.0)
  riskLevel: RiskLevel;        // "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
  uniquenessRate: number;      // fraction of records that are singletons
  highRiskRate: number;        // fraction of records with EC < k
  avgEcSize: number;           // mean EC size
  minK: number;                // smallest EC found
  uniqueRecordsCount: number;  // absolute count of singleton records
  histogram: {                 // EC size bucket histogram
    label: string;             //   e.g. "1 (Unique)", "2–4"
    count: number;             //   number of records in this bucket
    risk: number;              //   avg link score × 100 for this bucket
  }[];
  linkScoreDistribution: {
    bucket: string;            // e.g. "1.00 (certain)"
    count: number;             // records in this risk band
  }[];
  topVulnerable: {
    qiCombo: string;           // "age=25, gender=Male, ..."
    qiValues: Record<string, string>;
    linkScore: number;
    ecSize: number;
    reason: string;            // "Singleton — no look-alike" or "EC size X < k=Y"
  }[];
  recommendations: string[];
  equivalenceClasses: EquivalenceClass[];
  totalRecords: number;

  // ── New spec fields ───────────────────────────────────────────────────────
  sampleN: number;                    // actual rows analysed
  reIdRisk: number;                   // primary metric (0.0–1.0)
  atRiskCount: number;                // records with EC < k
  protectedCount: number;             // records with EC >= k
  quasiIdentifiers: string[];         // QI column names used
  recordTable: ProsecutorRecordRow[]; // one entry per row
  ecSizeTable: {                      // structured EC size breakdown
    label: string;
    numECs: number;
    numRecords: number;
    pct: string;                      // e.g. "23.5%"
  }[];
  lDiversityResults: ProsecutorLDivResult[];
  tClosenessResults: ProsecutorTCloseResult[];
  topVulnerableRecord: ProsecutorRecordRow | null;
}

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
```

---

## 6. Input Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `data` | `DataRow[]` | — | All rows of the dataset (after sampling) |
| `quasiIdentifiers` | `string[]` | — | Column names to use as QIs |
| `kThreshold` | `number` | 5 | Minimum acceptable EC size |
| `sensitiveAttributes` | `string[]` | `[]` | Columns for L-Diversity & T-Closeness checks |
| `lThreshold` | `number` | 3 | Minimum distinct SA values per EC |
| `tThreshold` | `number` | 0.2 | Maximum allowable TVD (Total Variation Distance) |

---

## 7. Computation Pipeline (10 Steps)

### Step 1 — Build the EC Map

```typescript
const ecMap = new Map<string, number[]>();

data.forEach((row, idx) => {
  // Create a canonical key from all QI values, pipe-separated
  const key = quasiIdentifiers
    .map((qi) => String(row[qi] ?? ""))
    .join("|");

  const existing = ecMap.get(key);
  if (existing) existing.push(idx);
  else ecMap.set(key, [idx]);
});
```

**Example:**  
QIs = `["gender", "age_band", "district"]`  
Row with `{gender: "M", age_band: "25–30", district: "Pune"}` → key = `"M|25–30|Pune"`

All rows sharing this key form one EC.

---

### Step 2 — Per-Record Link Scores

```typescript
// First pass: assign EC size to every row index
const ecSizeArr: number[] = new Array(n);
ecMap.forEach((indices) => {
  const sz = indices.length;
  indices.forEach((i) => { ecSizeArr[i] = sz; });
});

// Second pass: build record table
let totalLinkScore = 0;
const recordTable: ProsecutorRecordRow[] = data.map((row, idx) => {
  const sz   = ecSizeArr[idx];
  const ls   = 1 / sz;              // ← core Prosecutor formula
  totalLinkScore += ls;

  const qiValues: Record<string, string> = {};
  quasiIdentifiers.forEach((qi) => { qiValues[qi] = String(row[qi] ?? ""); });

  return {
    rowIdx: idx + 1,
    qiValues,
    ecSize: sz,
    linkScore: parseFloat(ls.toFixed(4)),
    atRisk: sz < kThreshold,         // fails k-anonymity
  };
});
```

---

### Step 3 — Aggregate Metrics

```typescript
const reIdRisk          = totalLinkScore / n;          // avg link score
const uniqueRecordsCount = Array.from(ecMap.values())
                             .filter(v => v.length === 1).length;
const atRiskCount       = recordTable.filter(r => r.atRisk).length;
const protectedCount    = n - atRiskCount;
const uniquenessRate    = uniqueRecordsCount / n;
const highRiskRate      = atRiskCount / n;
const avgEcSize         = n / ecMap.size;
const minK              = Math.min(...Array.from(ecMap.values()).map(v => v.length));
```

---

### Step 4 — EC Size Histogram (5 Buckets)

```typescript
const buckets = [
  { label: "1 (Unique)", min: 1,  max: 1        },
  { label: "2–4",        min: 2,  max: 4        },
  { label: "5–10",       min: 5,  max: 10       },
  { label: "11–20",      min: 11, max: 20       },
  { label: ">20",        min: 21, max: Infinity  },
];

const histogram = buckets.map((b) => {
  const matching = ecs.filter(ec => ec.size >= b.min && ec.size <= b.max);
  const count    = matching.reduce((s, ec) => s + ec.size, 0);  // total records
  const avgRisk  = matching.length > 0
    ? matching.reduce((s, ec) => s + 1 / ec.size, 0) / matching.length
    : 0;
  return {
    label: b.label,
    count,
    risk: parseFloat((avgRisk * 100).toFixed(1)),  // avg risk% for chart tooltip
  };
});
```

**Colors used in chart:**
```
Bucket 0 "1 (Unique)" → #DC2626  (red)
Bucket 1 "2–4"         → #EA580C  (orange)
Bucket 2 "5–10"        → #D97706  (amber)
Bucket 3 "11–20"       → #2563EB  (blue)
Bucket 4 ">20"         → #16A34A  (green)
```

---

### Step 5 — EC Size Table (Structured Breakdown)

```typescript
const ecSizeTable = buckets.map((b) => {
  const matchingEcs = ecs.filter(ec => ec.size >= b.min && ec.size <= b.max);
  const numRecords  = matchingEcs.reduce((s, ec) => s + ec.size, 0);
  return {
    label:      b.label,
    numECs:     matchingEcs.length,
    numRecords,
    pct:        n > 0
                  ? ((numRecords / n) * 100).toFixed(1) + "%"
                  : "0%",
  };
});
```

---

### Step 6 — Link Score Distribution (5 Risk Bands)

```typescript
const scoreBuckets = [
  { bucket: "1.00 (certain)",   min: 1.0,  max: 1.0   },
  { bucket: "0.51–0.99 (high)", min: 0.51, max: 0.999 },
  { bucket: "0.26–0.50 (med)",  min: 0.26, max: 0.50  },
  { bucket: "0.01–0.25 (low)",  min: 0.01, max: 0.25  },
  { bucket: "0.00 (safe)",      min: 0.0,  max: 0.0   },
];

const linkScoreDistribution = scoreBuckets.map(({ bucket, min, max }) => {
  const count = recordTable.filter(r => {
    if (min === max) return Math.abs(r.linkScore - min) < 0.0001;
    return r.linkScore >= min && r.linkScore <= max;
  }).length;
  return { bucket, count };
});
```

**Meaning of each band:**

| Band | Score | Meaning |
|---|---|---|
| `1.00 (certain)` | 1.0 | Attacker is 100% certain — singleton record |
| `0.51–0.99 (high)` | >0.5 | More likely correct than not |
| `0.26–0.50 (med)` | 0.26–0.5 | Coin-flip or worse for attacker |
| `0.01–0.25 (low)` | 0.01–0.25 | Attacker has <25% chance |
| `0.00 (safe)` | 0.0 | Effectively anonymous |

---

### Step 7 — Top 10 Most Vulnerable Records

```typescript
const sortedByRisk  = [...recordTable].sort((a, b) => b.linkScore - a.linkScore);
const top10         = sortedByRisk.slice(0, 10);

const topVulnerable = top10.map(r => ({
  qiCombo:  quasiIdentifiers.map(qi => `${qi}=${r.qiValues[qi]}`).join(", "),
  qiValues: r.qiValues,
  linkScore: r.linkScore,
  ecSize:    r.ecSize,
  reason:    r.ecSize === 1
               ? "Singleton — no look-alike"
               : `EC size ${r.ecSize} < k=${kThreshold}`,
}));

const topVulnerableRecord = top10[0] ?? null;
```

---

### Step 8 — L-Diversity Check (per sensitive attribute)

For each sensitive attribute `sa`, iterate over every EC:

```typescript
const lDiversityResults = sensitiveAttributes.map(sa => {
  let minL           = Infinity;
  let violatingEcs   = 0;
  let violatingRecords = 0;

  ecMap.forEach((indices) => {
    // Collect distinct SA values within this EC
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
    sa,
    minL,
    violatingEcs,
    totalEcs:           ecMap.size,
    violatingRecordPct: parseFloat(((violatingRecords / n) * 100).toFixed(1)),
    status:             violatingEcs === 0 ? "PASS" : "FAIL",
  };
});
```

**Pass condition:** Every EC has at least `lThreshold` distinct values for attribute `sa`.

**Singleton EC caveat:** If almost all ECs are singletons (|singleton ECs| ≥ 0.9 × N), the L-Diversity failures are a **structural artifact** — any group of size 1 can only have 1 distinct SA value. The UI surfaces a warning in this case to avoid false alarms.

---

### Step 9 — T-Closeness Check (Total Variation Distance)

For each sensitive attribute `sa`:

```typescript
const tClosenessResults = sensitiveAttributes.map(sa => {
  // 1. Build global distribution across entire dataset
  const globalCounts = new Map<string, number>();
  data.forEach(row => {
    const v = String(row[sa] ?? "");
    globalCounts.set(v, (globalCounts.get(v) ?? 0) + 1);
  });
  const globalDist: Record<string, number> = {};
  globalCounts.forEach((count, v) => { globalDist[v] = count / n; });
  const allValues = Array.from(globalCounts.keys());

  let maxDistance  = 0;
  let violatingEcs = 0;

  // 2. For each EC, compute TVD between local and global distribution
  ecMap.forEach((indices) => {
    const localCounts = new Map<string, number>();
    indices.forEach(i => {
      const v = String(data[i][sa] ?? "");
      localCounts.set(v, (localCounts.get(v) ?? 0) + 1);
    });
    const sz = indices.length;

    // TVD = 0.5 × Σ |P_local(v) - P_global(v)|
    let tvd = 0;
    allValues.forEach(v => {
      const lp = (localCounts.get(v) ?? 0) / sz;
      const gp = globalDist[v] ?? 0;
      tvd += Math.abs(lp - gp);
    });
    tvd = tvd / 2;  // ← factor of 1/2 converts L1 to TVD

    if (tvd > maxDistance) maxDistance = tvd;
    if (tvd > tThreshold)  violatingEcs++;
  });

  return {
    sa,
    maxDistance: parseFloat(maxDistance.toFixed(4)),
    violatingEcs,
    totalEcs: ecMap.size,
    status:   violatingEcs === 0 ? "PASS" : "FAIL",
  };
});
```

**Total Variation Distance formula:**
```
TVD(P_local, P_global) = 0.5 × Σ_v | P_local(v) − P_global(v) |
```

**Pass condition:** Every EC has `TVD ≤ tThreshold`.

**Range:** TVD ∈ [0, 1].  
- TVD = 0: EC distribution is identical to global → maximum privacy  
- TVD = 1: EC distribution is completely different from global → maximum information leakage  
- Typical threshold: t = 0.2 (NIST recommendation for health data)

**Singleton EC caveat:** Singleton ECs always produce TVD approaching 1.0 (a single record is 100% one SA value, making the local distribution a point mass). The UI shows a structural artifact warning when most ECs are singletons.

---

### Step 10 — Conditional Recommendations

```typescript
const recommendations: string[] = [];

// Rule 1: Singleton records exist
if (uniqueRecordsCount > 0) {
  recommendations.push(
    `🔴 CRITICAL — ${uniqueRecordsCount} singleton record(s) found. ` +
    `Suppress these rows before release, OR generalize ${topQI} using range brackets.`
  );
}

// Rule 2: Re-ID risk is high
if (reIdRisk > 0.2) {
  recommendations.push(
    `🔴 HIGH — Re-ID risk is ${(reIdRisk*100).toFixed(1)}% (threshold: <5%). ` +
    `Apply k-anonymisation to bring Min-K up to at least ${kThreshold}.`
  );
} else if (reIdRisk > 0.05) {
  recommendations.push(
    `🟡 MEDIUM — Re-ID risk ${(reIdRisk*100).toFixed(1)}% is above 5% safe threshold. ` +
    `Consider additional generalisation.`
  );
}

// Rule 3: L-Diversity violations
lDiversityResults.filter(r => r.status === "FAIL").forEach(r => {
  recommendations.push(
    `🟡 MEDIUM — L-Diversity violated for "${r.sa}" ` +
    `(${r.violatingEcs}/${r.totalEcs} ECs fail). ` +
    `Ensure each group has ≥${lThreshold} distinct ${r.sa} values.`
  );
});

// Rule 4: T-Closeness violations
tClosenessResults.filter(r => r.status === "FAIL").forEach(r => {
  recommendations.push(
    `🟡 MEDIUM — T-Closeness violated for "${r.sa}" ` +
    `(max distance ${r.maxDistance} > ${tThreshold}). ` +
    `Distribution differs too much from global.`
  );
});

// All clear
if (recommendations.length === 0) {
  recommendations.push(
    `✅ Prosecutor attack risk is within acceptable bounds ` +
    `(Re-ID: ${(reIdRisk*100).toFixed(1)}%, Min-K: ${minK} ≥ ${kThreshold}).`
  );
}

// Always append next step
recommendations.push(
  `ℹ️ NEXT STEP — Go to "Privacy Enhancement" to apply fixes automatically, ` +
  `then re-run this assessment to verify improvement.`
);
```

---

## 8. Risk Thresholds & Classification

### Primary Risk Level (RiskLevel type)

Used by composite scoring and comparison dashboard:

| Score Range | Level | Color Code |
|---|---|---|
| `≥ 0.70` | CRITICAL | `#DC2626` (red-600) |
| `0.50 – 0.69` | HIGH | `#EA580C` (orange-600) |
| `0.30 – 0.49` | MEDIUM | `#D97706` (amber-600) |
| `< 0.30` | LOW | `#16A34A` (green-600) |

```typescript
export function getRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return "CRITICAL";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}
```

### UI Banner Thresholds (result display)

| Re_ID_Risk | Banner Color | Label |
|---|---|---|
| `> 0.20` | Red | HIGH |
| `0.05 – 0.20` | Amber | MEDIUM |
| `≤ 0.05` | Green | LOW |

### Link Score Color Coding (record table)

| Link Score | Color | CSS class |
|---|---|---|
| `≥ 0.5` | Red | `text-red-600` |
| `0.2 – 0.49` | Amber | `text-amber-600` |
| `< 0.2` | Green | `text-green-600` |

### Record Status Labels

```typescript
function statusLabel(atRisk: boolean, linkScore: number, k: number, ecSize: number) {
  if (linkScore === 1.0)
    return { label: "🔴 UNIQUELY IDENTIFIABLE", cls: "text-red-700 font-bold" };
  if (atRisk)
    return { label: `🟠 LOW PROTECTION (k=${ecSize}<${k})`, cls: "text-orange-600" };
  return { label: "🟢 PROTECTED", cls: "text-green-700" };
}
```

---

## 9. L-Diversity Sub-Check

### Definition

**l-Diversity** (Machanavajjhala et al., 2007) extends k-anonymity by requiring that each equivalence class contains at least `l` **distinct** values for every sensitive attribute.

This protects against **homogeneity attacks** where all records in an EC share the same sensitive attribute value (so even if you cannot tell *which* person it is, you know their health condition, income, etc.).

### Variant Used: Distinct l-Diversity

The simplest and strictest variant:
```
EC satisfies l-diversity for SA ⟺ |{distinct values of SA in EC}| ≥ l
```

### When L-Diversity Results Are Unreliable

The UI detects and warns about a **structural artifact**:

```
Artifact condition: |{singleton ECs}| ≥ 0.9 × N
```

When this is true, every group has exactly 1 record, so by definition only 1 distinct SA value exists. The L-Diversity failures are mathematically inevitable and do not represent real homogeneity risk. The fix is to reduce QI granularity so that more records share the same group.

---

## 10. T-Closeness Sub-Check (TVD)

### Definition

**t-Closeness** (Li et al., 2007) requires that the distribution of a sensitive attribute within each EC is "close" to the global distribution across the entire dataset.

If an EC's SA distribution diverges significantly from global, an attacker who identifies the EC group learns more about the SA than they would from random chance.

### Metric: Total Variation Distance (TVD)

```
TVD(P_local, P_global) = (1/2) × Σ_v | P_local(v) − P_global(v) |

where:
  P_local(v)  = Count(SA=v in EC) / |EC|
  P_global(v) = Count(SA=v in D) / N
  v ranges over all distinct values of SA
```

The factor of `1/2` ensures TVD ∈ [0, 1]:
- `TVD = 0`: Distributions are identical
- `TVD = 1`: Distributions are completely disjoint

### Example Calculation

Dataset: 100 records. SA = `health_condition`. Global distribution:
```
Diabetic: 40%,  Healthy: 40%,  Hypertensive: 20%
```

EC of size 5 with all "Diabetic":
```
P_local = { Diabetic: 100%, Healthy: 0%, Hypertensive: 0% }
TVD = 0.5 × (|1.0-0.4| + |0.0-0.4| + |0.0-0.2|)
    = 0.5 × (0.6 + 0.4 + 0.2)
    = 0.5 × 1.2
    = 0.60   ← exceeds threshold of 0.20, FAIL
```

---

## 11. Recommendations Engine

The recommendations system fires in priority order:

| Priority | Trigger Condition | Message |
|---|---|---|
| 1 (🔴 CRITICAL) | `uniqueRecordsCount > 0` | Suppress singletons or generalize top QI |
| 2 (🔴 HIGH) | `reIdRisk > 0.20` | Apply k-anonymization, target threshold |
| 3 (🟡 MEDIUM) | `reIdRisk ∈ (0.05, 0.20]` | Consider additional generalization |
| 4 (🟡 MEDIUM) | L-Diversity FAIL | Per-SA message with violating EC count |
| 5 (🟡 MEDIUM) | T-Closeness FAIL | Per-SA message with max TVD |
| ✅ (OK) | No violations | Confirmation that risk is within bounds |
| ℹ️ (Always) | Always appended | Directs user to Privacy Enhancement module |

---

## 12. Result UI — All Sections

The `ProsecutorReport` React component renders **10 distinct sections** in vertical order.

### §4.1 — Attack Summary Banner

**Purpose:** Immediate at-a-glance risk assessment.  
**Layout:** Full-width colored banner (red/amber/green) with border and background tint.

**Content:**
- Header: "🎯 Prosecutor Attack Results" + Risk Level badge (HIGH / MEDIUM / LOW)
- Metadata row: Rows analysed | QIs used
- Plain-English summary sentence:
  > "An attacker who already knows a person is in this dataset can correctly identify **X%** of individuals using only *age, gender, district*. Out of **N** records, **M** people are completely unique — they can each be pinpointed with 100% certainty."

**Color logic:**
```
reIdRisk > 0.20 → red border + bg-red-50
reIdRisk > 0.05 → amber border + bg-amber-50
else            → green border + bg-green-50
```

---

### §4.2 — Key Metrics Row (4 KPI Cards)

**Layout:** 2×2 grid (mobile) / 4-column row (desktop)

| Card | Value | Subtitle | Red Threshold |
|---|---|---|---|
| Re-ID Risk | `XX.X%` | "Avg chance attacker correctly IDs a person" | `> 20%` |
| Unique Records | `N` | "Singletons — 100% identifiable (k=1)" | `> 0` |
| Avg EC Size | `X.X` | "Mean group size sharing same QI values" | `< kThreshold` |
| Min-K | `N` | "Smallest group — worst-case exposure" | `< kThreshold` |

Each card header value is colored red/amber/green based on threshold.

---

### §4.3 — Record-Level Attack Trace Table

**Purpose:** Full per-row breakdown of every record in the dataset.  
**Interactive controls:**
- **Filter buttons:** `Show All` | `🔴 At Risk Only` | `🟢 Protected Only`
- **Search box:** Real-time QI value search across all QI columns
- **Pagination:** 50 records per page with prev/next navigation
- **CSV export:** Downloads all records as `prosecutor_attack_record_level.csv`

**Table columns:**
```
Row # | [QI column 1] | [QI column 2] | ... | Group Size | Link Score | Status
```

**Status labels and colors:**
- `🔴 UNIQUELY IDENTIFIABLE` → red, bold (linkScore = 1.0)
- `🟠 LOW PROTECTION (k=X<Y)` → orange (atRisk = true, linkScore < 1.0)
- `🟢 PROTECTED` → green (EC size ≥ kThreshold)

**CSV format:**
```csv
Row#,age,gender,district,EC_Size,Link_Score,Status
1,"25","Male","Pune",1,1.0000,UNIQUELY_IDENTIFIABLE
2,"30","Female","Mumbai",5,0.2000,PROTECTED
```

---

### §4.4 — Attack Simulation Narrative

**Purpose:** Step-by-step walkthrough of the actual attack using the single most vulnerable record's real values.  
**Condition:** Only rendered if `topVulnerableRecord !== null`  
**Style:** Monospace font, orange-tinted card border

**4 Steps displayed:**

```
Step 1 — Attacker's Knowledge
  The attacker knows a specific person is in this dataset.
  From a public record they know:
    age = 25
    gender = Male
    district = Pune

Step 2 — Database Query
  Attacker queries: "Show me all records where age=25 AND gender=Male AND district=Pune"
    Result: 1 record found. (Row #42)

Step 3 — Re-identification
  Since only 1 record matches, the attacker has identified
  this person with 100% certainty. They now know all sensitive
  attributes for this individual.
  — OR —
  With X records matching, the attacker has a Y% chance of
  correctly identifying this person.

Step 4 — Scale
  This attack was possible (link score ≥ 0.5) on Z out of N records.
  P% of your dataset is fully re-identifiable (singleton records).
```

---

### §4.5 — Equivalence Class Size Distribution

**Layout:** 2-column grid (chart left, table right)

**Left — Horizontal Bar Chart (Recharts `BarChart` with `layout="vertical"`):**
- Y-axis: EC size bucket labels
- X-axis: Count of records
- Each bar is color-coded by risk level (red → green)
- Tooltip shows record count

**Right — EC Size Table:**

| Column | Description |
|---|---|
| EC Size | Bucket label |
| # ECs | Number of equivalence classes in this range |
| # Records | Total records in ECs of this size |
| % Dataset | Fraction of all records |

---

### §4.6 — Link Score Distribution

**Layout:** 2-column grid (chart left, interpretation table right)

**Left — Vertical Bar Chart:**
- X-axis: 5 risk bands
- Y-axis: Record count
- Colors from red (certain) to green (safe)

**Right — Interpretation Table:**

| Score Range | # Records | Meaning |
|---|---|---|
| 1.00 (certain) | N | Attacker is 100% certain |
| 0.51–0.99 (high) | N | More likely correct than not |
| 0.26–0.50 (med) | N | Coin-flip or worse for attacker |
| 0.01–0.25 (low) | N | Attacker has <25% chance |
| 0.00 (safe) | N | Effectively anonymous |

---

### §4.7 — L-Diversity Check

**Condition:** Only rendered if `lDiversityResults.length > 0` (sensitive attributes were selected)

**Structural artifact warning** (shown when `totalEcs ≥ 0.9 × N`):
> "All N equivalence classes are singletons... L-Diversity failures are a mathematical inevitability — not evidence of a homogeneity attack."

**Per-SA result card:**
- SA name in header
- PASS / FAIL badge (green / red)
- Min distinct values in any EC
- Violating ECs count + percentage
- Contextual explanation if FAIL

---

### §4.8 — T-Closeness Check

**Condition:** Only rendered if `tClosenessResults.length > 0`

**Structural artifact warning** (shown when `totalEcs ≥ 0.9 × N`):
> "Singleton ECs always deviate maximally (TVD → 1.0)..."

**Per-SA result card:**
- SA name in header
- PASS / FAIL badge (green / red)
- Maximum EC deviation from global distribution
- Violating ECs count
- Contextual explanation if FAIL

---

### §4.9 — Risk–Protection Split Donut Chart

**Left — Donut Pie Chart:**
- Inner radius 55, outer radius 80
- Red segment: "At Risk (N)" — records with EC < k
- Green segment: "Protected (N)" — records with EC ≥ k
- Caption: "At Risk: N records (X%) — EC size < k=Y / Protected: N records (X%) — EC size ≥ k"

---

### §4.10 — Top 10 Vulnerable Records

**Condition:** Right half of §4.9 grid

**Layout:** Scrollable table (200px max height) inside a Card

**Table columns:**

| Rank | QI Combination | Link Score | EC Size |
|---|---|---|---|
| 1 | age=25, gender=Male, district=Pune | 1.00 | 1 |
| 2 | age=30, gender=Female, district=Mumbai | 0.50 | 2 |

- QI Combination truncated to 40 chars with ellipsis
- Link Score shown in bold red
- Accompanied by CardDescription: "These rows should be suppressed or generalized before releasing this dataset."

---

### §4.11 — Recommendations Card

**Location:** Always last, full-width  
**Component:** `RecommendationsCard` (shared across all attacks)  
**Content:** Ordered list of recommendation strings from `recommendations[]` array  
**Visual:** Emoji prefix indicates severity (🔴 🟡 ✅ ℹ️)

---

## 13. CSV Export

### Trigger
Button in §4.3 header: "⬇ Download CSV"

### Format
```
Filename: prosecutor_attack_record_level.csv

Header row:
  Row#,[QI1],[QI2],...,[QIn],EC_Size,Link_Score,Status

Data rows:
  1,"Male","25","Pune",1,1.0,UNIQUELY_IDENTIFIABLE
  2,"Female","30","Mumbai",5,0.2,PROTECTED

Status values:
  UNIQUELY_IDENTIFIABLE  ← linkScore === 1.0
  LOW_PROTECTION         ← atRisk = true (ecSize < k), linkScore < 1.0
  PROTECTED              ← ecSize >= kThreshold
```

### Implementation
```typescript
function downloadRecordCSV(r: ProsecutorResult) {
  const qis = r.quasiIdentifiers;
  const header = ["Row#", ...qis, "EC_Size", "Link_Score", "Status"].join(",");
  const rows = r.recordTable.map(row => {
    const st = row.linkScore === 1.0
      ? "UNIQUELY_IDENTIFIABLE"
      : row.atRisk ? "LOW_PROTECTION" : "PROTECTED";
    return [
      row.rowIdx,
      ...qis.map(qi => `"${row.qiValues[qi] ?? ""}"`),
      row.ecSize,
      row.linkScore,
      st,
    ].join(",");
  });
  const csv  = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "prosecutor_attack_record_level.csv";
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## 14. Helper Utilities

### `buildEquivalenceClasses(data, quasiIdentifiers)`

```typescript
export function buildEquivalenceClasses(
  data: DataRow[],
  quasiIdentifiers: string[]
): EquivalenceClass[] {
  const ecMap = new Map<string, EquivalenceClass>();
  data.forEach(row => {
    const key = quasiIdentifiers
      .map(qi => String(row[qi] ?? "")).join("|");
    if (!ecMap.has(key)) ecMap.set(key, { key, records: [], size: 0 });
    const ec = ecMap.get(key)!;
    ec.records.push(row);
    ec.size++;
  });
  return Array.from(ecMap.values());
}
```

### `sampleData(data, pct)`

```typescript
export function sampleData(data: DataRow[], pct: number): DataRow[] {
  if (pct >= 100) return data;
  const n        = Math.max(1, Math.round(data.length * pct / 100));
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
```

Used upstream before calling `runProsecutorAttack()` when the Sample Size slider is < 100%.

### `getRiskLevel(score)`

```typescript
export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 0.7) return "CRITICAL";
  if (score >= 0.5) return "HIGH";
  if (score >= 0.3) return "MEDIUM";
  return "LOW";
}
```

### `totalVariationDistance(local, global)`

Used in L-Diversity / T-Closeness utilities:

```typescript
export function totalVariationDistance(
  local: Map<string, number>,
  global: Map<string, number>
): number {
  const all = new Set([...Array.from(local.keys()), ...Array.from(global.keys())]);
  let tvd = 0;
  all.forEach(v => {
    tvd += Math.abs((local.get(v) || 0) - (global.get(v) || 0));
  });
  return tvd / 2;
}
```

---

## 15. Full Output Interface Reference

```typescript
// Primary entry point
runProsecutorAttack(
  data:                DataRow[],
  quasiIdentifiers:    string[],
  kThreshold:          number,        // default: 5
  sensitiveAttributes: string[],      // default: []
  lThreshold:          number,        // default: 3
  tThreshold:          number,        // default: 0.2
): ProsecutorResult

// Returns an emptyResult() if data.length === 0 or quasiIdentifiers.length === 0
```

### Key Properties Consumed by Other Modules

| Property | Used By | Purpose |
|---|---|---|
| `riskScore` | Composite Risk Score calculator | Weighted average across attacks |
| `riskLevel` | Risk Assessment dashboard | Overall severity badge |
| `reIdRisk` | Journalist Attack report | Reference comparison |
| `equivalenceClasses` | Privacy Enhancement module | Input for k-anonymization |
| `uniqueRecordsCount` | Home dashboard summary | Quick health indicator |
| `recommendations` | Summary panel | Consolidated action items |

---

## 16. Implementation Checklist

Use this checklist when implementing the Prosecutor Attack in a new project:

### Core Algorithm
- [ ] Build EC map: `key = QI values joined with "|"`
- [ ] Per-record link score: `1 / EC_size`
- [ ] Re-ID risk: `sum(link_scores) / N`
- [ ] Singleton detection: EC size exactly 1
- [ ] k-Anonymity violation: EC size < kThreshold
- [ ] Min-K: minimum EC size found
- [ ] Average EC size: `N / |distinct ECs|`

### Data Outputs
- [ ] `recordTable[]` with rowIdx, qiValues, ecSize, linkScore, atRisk
- [ ] `histogram[]` with 5 size buckets
- [ ] `ecSizeTable[]` with counts and percentages
- [ ] `linkScoreDistribution[]` with 5 risk bands
- [ ] `topVulnerable[]` sorted descending by linkScore
- [ ] `topVulnerableRecord` — single most vulnerable record (for narrative)

### L-Diversity
- [ ] Per-SA: distinct value set per EC
- [ ] Track minL (minimum distinct count across all ECs)
- [ ] Track violatingEcs and violatingRecords
- [ ] PASS if all ECs meet lThreshold
- [ ] Singleton artifact detection

### T-Closeness
- [ ] Build global SA distribution (frequency ratios)
- [ ] Per EC: build local SA distribution
- [ ] TVD = `0.5 × Σ |local(v) - global(v)|`
- [ ] Track maxDistance and violatingEcs
- [ ] PASS if all ECs have TVD ≤ tThreshold
- [ ] Singleton artifact detection

### UI Sections
- [ ] §4.1 Attack Summary Banner (colored, risk label)
- [ ] §4.2 4 KPI cards (Re-ID Risk, Unique Records, Avg EC Size, Min-K)
- [ ] §4.3 Record table (filterable, searchable, paginated, exportable)
- [ ] §4.4 Attack narrative (uses topVulnerableRecord real values)
- [ ] §4.5 EC size distribution (bar chart + table)
- [ ] §4.6 Link score distribution (bar chart + interpretation table)
- [ ] §4.7 L-Diversity results (conditional, with artifact warning)
- [ ] §4.8 T-Closeness results (conditional, with artifact warning)
- [ ] §4.9 Risk–Protection donut chart
- [ ] §4.10 Top 10 vulnerable records table
- [ ] §4.11 Recommendations card

### Edge Cases
- [ ] Empty dataset → return `emptyResult()`
- [ ] No QIs selected → return `emptyResult()`
- [ ] No sensitive attributes → skip L-Diversity and T-Closeness sections
- [ ] All records unique (minK = 1) → Re-ID Risk = 1.0 = 100%
- [ ] All records in one EC (minK = N) → Re-ID Risk = 1/N ≈ 0%
- [ ] Singleton EC artifacts in L-Diversity/T-Closeness → show warning banner

---

## References

- **NISTIR 8053** — De-Identification of Personal Health Information (NIST, 2015)
- **Sweeney (2002)** — k-Anonymity: A Model for Protecting Privacy
- **Machanavajjhala et al. (2007)** — l-Diversity: Privacy Beyond k-Anonymity
- **Li et al. (2007)** — t-Closeness: Privacy Beyond k-Anonymity and l-Diversity
- **Dwork (2006)** — Differential Privacy (for comparison with DP-based mitigations)
- **El Emam et al. (2011)** — A Systematic Review of Re-Identification Attacks

---

*Document generated from Airavata Platform — Ministry of Statistics and Programme Implementation, Government of India*  
*Feature author: Airavata Technologies | SIH 2024 Winner — Team 4208*
