/**
 * Shared HTML-escaping helper.
 *
 * Used by every string-templated HTML sink (print/PDF windows, standalone
 * download pages) that interpolates user- or model-provided text into a raw
 * HTML string before handing it to document.write / window.open.
 */
export function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
