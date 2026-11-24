/**
 * Build CSV that is safe to open in spreadsheet applications.
 * Text cells are quoted and cells beginning with formula characters (including
 * whitespace-prefixed formulas) are prefixed with an apostrophe to prevent
 * formula execution. Numeric values remain numeric.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const isFormulaText = typeof value === 'string' && /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(raw);
  const safe = isFormulaText ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
