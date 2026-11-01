// Экспорт CSV: одна общая ячейка для всех CSV-выгрузок (stats/export/competition).
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
