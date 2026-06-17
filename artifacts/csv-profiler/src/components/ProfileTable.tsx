import { useState } from "react";
import { Search, Edit3, Check, X } from "lucide-react";
import type { DataProfile, ColumnLayout } from "@/lib/csv-profiler";

interface Props {
  profile: DataProfile;
  selectedColumn: ColumnLayout | null;
  onSelectColumn: (col: ColumnLayout | null) => void;
  onUpdateQRef: (colIndex: number, sec: string, item: string, col: string, remarks: string) => void;
}

function EditableCell({
  value,
  onChange,
  placeholder = "",
  className = "",
  highlight = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  highlight?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    onChange(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full min-w-0 border border-primary/50 rounded px-1.5 py-0.5 text-xs bg-background focus:outline-none"
          style={{ maxWidth: 120 }}
        />
        <button onClick={commit} className="text-emerald-600 hover:text-emerald-700 flex-shrink-0">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1 cursor-pointer rounded px-1 -mx-1 transition-colors ${
        highlight ? "bg-amber-50 ring-1 ring-amber-200" : ""
      } ${className}`}
      onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value); }}
      title={highlight ? "Questionnaire field — click to fill in Sec/Item" : undefined}
    >
      <span className={value ? "text-foreground font-medium" : highlight ? "text-amber-400 italic text-[10px]" : "text-muted-foreground/40 italic"}>
        {value || (highlight ? "fill in" : placeholder)}
      </span>
      <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-40 flex-shrink-0" />
    </div>
  );
}

export function ProfileTable({ profile, selectedColumn, onSelectColumn, onUpdateQRef }: Props) {
  const [search, setSearch] = useState("");

  const filtered = profile.columns.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search columns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted rounded-lg border border-transparent focus:border-ring focus:outline-none"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {profile.totalColumns} columns &bull; Record length:{" "}
          <strong>{profile.totalRecordLength}</strong> bytes
        </span>
        <span className="text-xs text-muted-foreground ml-auto italic">
          Click a row for details &bull; Click Sec/Item/Col/Remarks to edit
        </span>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-b border-border/50 flex items-center gap-4 text-[10px] text-muted-foreground bg-muted/20">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 ring-1 ring-amber-200" />
          Questionnaire field — Sec/Item needs filling
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" />
          Frame / system variable — Sec/Item intentionally blank
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/60 border-b border-border">
              <th className="px-3 py-2 text-xs font-semibold text-foreground text-center border-r border-border" rowSpan={2}>
                Srl. no.
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-foreground border-r border-border" rowSpan={2}>
                Item
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-foreground text-center border-r border-border" colSpan={3}>
                Questionnaire reference
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-foreground text-center border-r border-border" rowSpan={2}>
                Length
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-foreground text-center border-r border-border" colSpan={2}>
                Byte position
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-foreground border-r border-border" rowSpan={2}>
                Remarks
              </th>
              <th className="px-3 py-2 text-xs font-semibold text-muted-foreground text-center" rowSpan={2}>
                Type
              </th>
            </tr>
            <tr className="bg-muted/40 border-b-2 border-border">
              <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-center border-r border-border w-12">Sec</th>
              <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-center border-r border-border w-16">Item</th>
              <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-center border-r border-border w-12">Col.</th>
              <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-center border-r border-border w-14">Start</th>
              <th className="px-3 py-1.5 text-xs font-medium text-muted-foreground text-center border-r border-border w-14">End</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((col) => {
              const isSelected = selectedColumn?.srlNo === col.srlNo;
              // Highlight questionnaire vars whose Sec is still unfilled
              const needsFill = col.isQuestionnaire && !col.qSec;

              return (
                <tr
                  key={col.srlNo}
                  onClick={() => onSelectColumn(isSelected ? null : col)}
                  className={`border-b border-border/60 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-primary/8 border-l-2 border-l-primary"
                      : needsFill
                      ? "hover:bg-amber-50/60 bg-amber-50/30"
                      : "hover:bg-accent/30"
                  }`}
                >
                  {/* Srl. no. */}
                  <td className="px-3 py-2 text-xs text-center text-muted-foreground font-mono border-r border-border/40">
                    {col.srlNo}
                  </td>

                  {/* Item / Column Name */}
                  <td className="px-3 py-2 font-medium text-foreground border-r border-border/40 whitespace-nowrap">
                    {col.name}
                    {col.isQuestionnaire && (
                      <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-500 border border-blue-100 align-middle">
                        Q
                      </span>
                    )}
                  </td>

                  {/* Sec */}
                  <td
                    className="px-3 py-2 text-xs text-center border-r border-border/40"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {col.isQuestionnaire ? (
                      <EditableCell
                        value={col.qSec}
                        onChange={(v) => onUpdateQRef(col.srlNo - 1, v, col.qItem, col.qCol, col.remarks)}
                        placeholder="—"
                        className="justify-center"
                        highlight={needsFill}
                      />
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>

                  {/* Item ref */}
                  <td
                    className="px-3 py-2 text-xs text-center border-r border-border/40"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {col.isQuestionnaire ? (
                      <EditableCell
                        value={col.qItem}
                        onChange={(v) => onUpdateQRef(col.srlNo - 1, col.qSec, v, col.qCol, col.remarks)}
                        placeholder="—"
                        className="justify-center"
                        highlight={needsFill}
                      />
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>

                  {/* Col ref */}
                  <td
                    className="px-3 py-2 text-xs text-center border-r border-border/40"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {col.isQuestionnaire ? (
                      <EditableCell
                        value={col.qCol}
                        onChange={(v) => onUpdateQRef(col.srlNo - 1, col.qSec, col.qItem, v, col.remarks)}
                        placeholder="—"
                        className="justify-center"
                      />
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>

                  {/* Length */}
                  <td className="px-3 py-2 text-xs text-center font-mono text-foreground font-semibold border-r border-border/40">
                    {col.length}
                  </td>

                  {/* Byte Start */}
                  <td className="px-3 py-2 text-xs text-center font-mono text-muted-foreground border-r border-border/40">
                    {col.byteStart}
                  </td>

                  {/* Byte End */}
                  <td className="px-3 py-2 text-xs text-center font-mono text-muted-foreground border-r border-border/40">
                    {col.byteEnd}
                  </td>

                  {/* Remarks */}
                  <td
                    className="px-3 py-2 text-xs text-muted-foreground italic border-r border-border/40 max-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EditableCell
                      value={col.remarks}
                      onChange={(v) => onUpdateQRef(col.srlNo - 1, col.qSec, col.qItem, col.qCol, v)}
                      placeholder="—"
                    />
                  </td>

                  {/* Type badge */}
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        col.type === "numeric"
                          ? "bg-blue-100 text-blue-700"
                          : col.type === "text"
                          ? "bg-violet-100 text-violet-700"
                          : col.type === "date"
                          ? "bg-amber-100 text-amber-700"
                          : col.type === "boolean"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {col.type}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No columns match your search
          </div>
        )}
      </div>
    </div>
  );
}
