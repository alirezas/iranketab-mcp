// Persian text helpers: digits, letter variants, whitespace.

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d));
  });
}

/** Folds Arabic yeh/kaf to Persian and trims - what users type vs what the site stores. */
export function faFold(s: string): string {
  return toLatinDigits(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ً-ْـ]/g, "") // harakat + tatweel
    .replace(/\s+/g, " ")
    .trim();
}

export function clean(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "142,500" / "۱۴۲۵۰۰" / "٪25" -> number, or null when there is no digit. */
export function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = toLatinDigits(s).replace(/[,٬]/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
