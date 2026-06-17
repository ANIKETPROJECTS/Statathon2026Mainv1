import * as XLSX from "xlsx";
import type { DataProfile } from "./csv-profiler";

interface LayoutRow {
  "Srl. No.": number;
  "Item": string;
  "Sec": string;
  "Item Ref": string;
  "Col.": string;
  "Length": number;
  "Byte Start": number;
  "Byte End": number;
  "Remarks": string;
  "Type": string;
}

function buildRows(profile: DataProfile): LayoutRow[] {
  return profile.columns.map((col) => ({
    "Srl. No.": col.srlNo,
    "Item": col.name,
    "Sec": col.isQuestionnaire ? col.qSec : "",
    "Item Ref": col.isQuestionnaire ? col.qItem : "",
    "Col.": col.isQuestionnaire ? col.qCol : "",
    "Length": col.length,
    "Byte Start": col.byteStart,
    "Byte End": col.byteEnd,
    "Remarks": col.remarks,
    "Type": col.type,
  }));
}

export function downloadCSV(profile: DataProfile): void {
  const rows = buildRows(profile);
  const headers = Object.keys(rows[0]) as (keyof LayoutRow)[];
  const lines: string[] = [
    headers.map((h) => JSON.stringify(h)).join(","),
    ...rows.map((r) =>
      headers.map((h) => {
        const v = r[h];
        return JSON.stringify(v ?? "");
      }).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, layoutFileName(profile.fileName, "csv"));
}

export function downloadExcel(profile: DataProfile): void {
  const rows = buildRows(profile);
  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws["!cols"] = [
    { wch: 8 },   // Srl. No.
    { wch: 40 },  // Item
    { wch: 6 },   // Sec
    { wch: 10 },  // Item Ref
    { wch: 6 },   // Col.
    { wch: 8 },   // Length
    { wch: 11 },  // Byte Start
    { wch: 9 },   // Byte End
    { wch: 40 },  // Remarks
    { wch: 8 },   // Type
  ];

  // Style header row bold (requires sheet_add_aoa for raw AOA approach — xlsx CE supports limited styling)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Layout");

  // Add a summary sheet
  const summaryData = [
    ["File", profile.fileName],
    ["Total rows", profile.totalRows],
    ["Total columns", profile.totalColumns],
    ["Record length (bytes)", profile.totalRecordLength],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary["!cols"] = [{ wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, layoutFileName(profile.fileName, "xlsx"));
}

function layoutFileName(csvFileName: string, ext: string): string {
  const base = csvFileName.replace(/\.[^.]+$/, "");
  return `Layout_${base}.${ext}`;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
