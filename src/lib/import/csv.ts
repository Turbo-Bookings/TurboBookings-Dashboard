// RFC 4180 CSV reader.
//
// Hand-rolled on purpose: the repo writes CSV with a 3-line escaper rather than
// a library (see reports/export/route.ts), and the only genuinely tricky parts
// of the format — a delimiter inside quotes, a newline inside quotes, and the
// "" escape — are exactly what a real scanner gets right for free. The failure
// mode people associate with hand-rolled CSV comes from `line.split(",")`,
// which this is not.
//
// The risks a library WOULD have covered are encoding and dialect problems
// introduced by round-tripping through Excel. Those we detect and refuse
// (guardEncoding) rather than silently mangle.

/** Parse CSV text into rows of raw string cells. */
export function parseCsv(input: string, delimiter = ","): string[][] {
  let s = input;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip UTF-8 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Distinguishes a trailing empty field ("a,b,") from end-of-input.
  let sawAny = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    // A quote only opens a quoted field at the START of that field. Mid-field
    // quotes (Excel-mangled output) are kept as literals rather than throwing.
    if (c === '"' && field === "") {
      inQuotes = true;
      sawAny = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      sawAny = true;
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++; // CRLF counts as one break
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAny = false;
      i++;
      continue;
    }
    field += c;
    sawAny = true;
    i++;
  }

  if (sawAny || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Guess the delimiter from the header line. Headers rarely contain an unquoted
 * delimiter, so counting on line 1 is enough — and the dry run shows the
 * operator what we picked, so a wrong guess is visible rather than silent.
 */
export function sniffDelimiter(sample: string): "," | ";" | "\t" {
  const first = sample.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => first.split(d).length - 1;
  const comma = count(",");
  const semi = count(";");
  const tab = count("\t");
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

/**
 * Refuse files we know we'd read wrong. A UTF-16 export read as UTF-8 arrives
 * riddled with NUL bytes; a mis-decoded file carries U+FFFD. Both produce
 * garbage that would otherwise import as real customer names.
 * Returns an operator-facing message, or null when the text looks sane.
 */
export function guardEncoding(text: string): string | null {
  // Escapes, not literals: a raw NUL / U+FFFD in source is easily mangled by
  // editors, which would silently turn this into a check for a space.
  if (text.includes("\u0000")) {
    return 'This file looks like UTF-16. In Excel, re-save it as "CSV UTF-8" and try again.';
  }
  if (text.includes("\uFFFD")) {
    return "This file has unreadable characters (U+FFFD) — re-export it as UTF-8 (names with accents would import wrong).";
  }
  return null;
}

export type Table = {
  headers: string[];
  /** One entry per data row: header → cell. Ragged rows are padded. */
  rows: Record<string, string>[];
  /** 1-based line numbers of rows whose cell count didn't match the header. */
  raggedRows: number[];
};

/**
 * Turn parsed cells into header-keyed records. Ragged rows are padded or
 * truncated and reported rather than dropped — a single malformed line in the
 * middle of a 300-row export shouldn't cost the operator the whole import.
 */
export function toTable(cells: string[][]): Table {
  const nonEmpty = cells.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], raggedRows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  const raggedRows: number[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const raw = nonEmpty[i];
    if (raw.length !== headers.length) raggedRows.push(i + 1);
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => {
      rec[h] = (raw[j] ?? "").trim();
    });
    rows.push(rec);
  }
  return { headers, rows, raggedRows };
}

/** Normalized key for fuzzy header matching: lowercase, alphanumerics only. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** CSV cell escaper — same idiom as the export routes. */
export function cell(s: string | number): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}
