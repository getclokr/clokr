/**
 * Issue #1155 - the ONE place a German decimal comma and a day count become text.
 *
 * Reports and PDFs (`composition/pdf-format.ts` re-exports it), notifications, warnings and error
 * answers all say "0,5 Tage", never "0.5 Tage"; a second implementation (`String(n)`,
 * `.replace(".", ",")`, a template-literal `${days} Tage`) is what this module exists to prevent,
 * guarded by `notification-texts-no-iso-date-1117.test.ts`.
 *
 * Pure and dependency-free: no `Intl` / `toLocaleString` (they depend on the runtime's locale data),
 * integer arithmetic only. The minus sign is the ASCII hyphen because PDFKit's built-in Helvetica
 * (WinAnsi) has no U+2212.
 */

/**
 * A number with a decimal comma and without trailing zeros, e.g. 0.5 -> "0,5", 1 -> "1",
 * 2.25 -> "2,25". `maxDigits` is the maximum number of decimal places (default 2).
 */
export function fmtDecimalDe(n: number, maxDigits = 2): string {
  const scale = 10 ** maxDigits;
  // The epsilon keeps a binary-float value such as 2.255 * 10 = 22.549999... on the side the
  // decimal reading expects.
  const scaled = Math.round(Math.abs(n) * scale + 1e-9);
  const intPart = Math.floor(scaled / scale);
  const fraction = scaled % scale;
  const sign = n < 0 && scaled !== 0 ? "-" : "";
  if (fraction === 0) return `${sign}${intPart}`;
  // Trailing zeros are dropped by integer division, not by a regex (fraction is non-zero here).
  let trimmed = fraction;
  let width = maxDigits;
  while (trimmed % 10 === 0) {
    trimmed /= 10;
    width -= 1;
  }
  const digits = String(trimmed).padStart(width, "0");
  return `${sign}${intPart},${digits}`;
}

/** A day count with the right number word: "1 Tag", "2 Tage", "0,5 Tage", "0 Tage". */
export function fmtDays(n: number): string {
  const text = fmtDecimalDe(n);
  return text === "1" ? "1 Tag" : `${text} Tage`;
}
