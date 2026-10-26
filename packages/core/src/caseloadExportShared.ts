/**
 * The caseload as a spreadsheet, with the organization's custom fields.
 * Pure: the route reads the rows (reach-limited) and the values (reach-
 * limited), this file only writes the file.
 *
 * THE SENSITIVE RULE. A sensitive field (isSensitiveField) is left out
 * unless the person exporting ticked it by id. Retired fields stay in, marked,
 * because an export is the record. Cells that a spreadsheet would run as a
 * formula (=, +, -, @ at the start) are written as text.
 */
import { exportableFields, formatCustomFieldValue, isSensitiveField, type CustomFieldDef } from "./customFieldsShared";

export interface CaseloadExportRow {
  userId: string;
  name: string | null;
  email: string | null;
  currentStage: number;
  nextStepAction: string | null;
  applications: number;
  hired: boolean;
  lastActiveAt: string | null;
  joinedAt: string;
  assignedStaffName: string | null;
}

/** Text for a CSV cell: quoted when needed, formula-safe always. */
export function caseloadCsvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCaseloadCsv(
  rows: CaseloadExportRow[],
  defs: CustomFieldDef[],
  values: Record<string, Record<string, unknown>>,
  opts: { includeSensitiveIds?: Iterable<string>; staffNames?: ReadonlyMap<string, string> } = {},
): { csv: string; fields: CustomFieldDef[]; sensitiveIncluded: string[] } {
  const fields = exportableFields(defs.filter((d) => d.entity === "participant"), opts.includeSensitiveIds ?? [])
    .sort((a, b) => Number(!!a.retiredAt) - Number(!!b.retiredAt) || a.position - b.position);
  const header = ["name", "email", "stage", "next_step", "applications", "hired", "last_active", "joined", "case_manager",
    ...fields.map((f) => `${f.label}${f.retiredAt ? " (retired)" : ""}`)];
  const lines = rows.map((c) => {
    const mine = values[c.userId] ?? {};
    return [
      c.name, c.email, c.currentStage, c.nextStepAction, c.applications, c.hired ? "yes" : "no",
      c.lastActiveAt ? c.lastActiveAt.slice(0, 10) : "", c.joinedAt ? c.joinedAt.slice(0, 10) : "", c.assignedStaffName,
      ...fields.map((f) => formatCustomFieldValue(f, mine[f.key], opts.staffNames, { csv: true })),
    ].map(caseloadCsvCell).join(",");
  });
  return {
    csv: [header.map(caseloadCsvCell).join(","), ...lines].join("\n"),
    fields,
    sensitiveIncluded: fields.filter((f) => isSensitiveField(f)).map((f) => f.key),
  };
}
