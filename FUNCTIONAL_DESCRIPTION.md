# AIRAVATA DEA — Functional Description

**AIRAVATA DEA** (Data Encryption & Anonymization) is a browser-based tool for converting, profiling, and assessing the privacy risk of statistical survey datasets — specifically NSSO/HCES fixed-width format (FWF) data.

All data processing happens entirely in the browser. No survey data is ever uploaded to a server.

---

## Core Capabilities

### 1. FWF to CSV Conversion

Fixed-Width Format (FWF) files store each record as a row of characters where each field occupies a fixed byte range. AIRAVATA DEA converts these files to structured CSV using a layout specification.

**Inputs required:**
- **Layout file** — an Excel (`.xlsx`) or CSV file with columns: `Field_Name`, `Start`, `End` (and optionally `Length`). Multiple layout files are supported (one per record type).
- **Data files** — the raw `.txt` or `.dat` FWF files.

**How it works:**
1. The layout is parsed and field positions are extracted (with automatic header alias detection for common column name variants).
2. Each line of the FWF file is sliced byte-by-byte according to the layout positions.
3. Records are processed in chunks of 50,000 lines to keep the UI responsive on large files.
4. The result is a downloadable CSV file.

---

### 2. Data Profiling

Once a CSV is loaded (either converted or uploaded directly), the profiler analyzes every column and reports:

| Metric | Description |
|---|---|
| Data type | Detected type: numeric, text, boolean, or date |
| Fill rate | Percentage of non-empty values |
| Unique count | Number of distinct values |
| Min / Max | Range of values (numeric columns) |
| Mean / Median | Central tendency (numeric columns) |
| Top values | Most frequent values (categorical columns) |

Columns are automatically classified as **Frame variables** (identifiers, geographic codes) or **Questionnaire variables** (responses) using a built-in NSSO/HCES data dictionary.

---

### 3. Privacy Risk Assessment — Prosecutor Attack Model

The risk assessment simulates an adversary who already knows a target individual is in the dataset (the "prosecutor" threat model) and tries to re-identify them using publicly available background knowledge.

**Setup:**
- Select one or more **Quasi-Identifiers (QIs)** — attributes that could link a record to a real person (e.g., Age, Gender, District, Household size).
- Optionally select **Sensitive Attributes** — values the adversary must not learn (e.g., income, disease status).

**Metrics calculated:**

| Metric | What it means |
|---|---|
| **Equivalence Class (EC)** | Group of records that share identical QI values. Smaller groups = higher risk. |
| **Link Score** | `1 / EC size`. A singleton (EC of 1) has a score of 1.0 — fully re-identifiable. |
| **k-Anonymity** | Minimum EC size across the dataset. A k of 1 means at least one record is unique. |
| **Uniqueness Rate** | Percentage of records that are singletons (k=1). |
| **Re-ID Risk** | Average link score across all records — the overall re-identification risk. |
| **l-Diversity** | Checks that each EC contains at least `l` distinct values of the sensitive attribute. Guards against attribute disclosure. |
| **t-Closeness** | Checks that the distribution of the sensitive attribute within each EC is close to its global distribution (within threshold `t`). |

Records that fall below a k threshold (default: 5) are flagged as **At Risk** and can be exported in a record-level CSV risk log.

---

### 4. Original vs. Anonymized Comparison

The tool supports loading two datasets — an **original** and an **anonymized** version — and comparing their privacy metrics side by side.

**Comparison view shows:**
- Change in Unique Records
- Change in Re-ID Risk (average link score)
- Change in Minimum k
- Change in Uniqueness Rate
- l-Diversity and t-Closeness pass/fail for both versions

This workflow supports validation of anonymization techniques such as generalization, suppression, or micro-aggregation.

---

### 5. Report Generation

After running a risk assessment, a detailed report can be downloaded in two formats:

| Format | Contents |
|---|---|
| **Word (.docx)** | Full narrative report with dataset summary, QI selection rationale, EC distribution charts, metric tables, and risk recommendations. |
| **CSV** | Record-level risk log with each record's EC size, link score, and at-risk flag. |

---

## Application Pages

| Route | Name | Description |
|---|---|---|
| `/` | FWF Converter | Upload layout + FWF data files, convert to CSV, and run initial profiling. |
| `/risk-assessment/original` | Original File | Load the original dataset, select QIs and sensitive attributes, run Prosecutor Attack. |
| `/risk-assessment/anonymized` | Anonymized File | Load the anonymized dataset and run the same assessment. |
| `/risk-assessment/comparison` | Comparison | Side-by-side metric comparison between original and anonymized results. |

---

## Technical Notes

- All computation runs **client-side** in the browser via Web Workers-friendly chunked processing. No data leaves the user's machine during analysis.
- Large files (millions of records) are handled through chunked iteration to avoid UI freezes.
- The backend API server (`/api/*`) currently provides only a health-check endpoint (`/api/healthz`). It is the foundation for future server-side features.
- The database layer (Drizzle ORM + PostgreSQL) is scaffolded and ready for future persistence features (saved profiles, audit logs, etc.) but is not used by any current feature.

---

## Intended Users

- **Data managers and statisticians** working with NSSO/HCES or similar large-scale survey microdata.
- **Privacy officers** needing to assess and document re-identification risk before data release.
- **Researchers** applying statistical disclosure control (SDC) techniques and needing to verify the effectiveness of anonymization.
