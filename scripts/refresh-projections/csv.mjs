// CSV field codec shared by the scraper (write side, scrape.mjs) and the
// processor (read side, process.mjs).
//
// Write side hardening, in encode order:
//   1. Formula guard — scraped strings starting with = + - @ TAB or CR would
//      execute as formulas when the committed audit CSVs are opened in
//      Excel/Sheets. Such values get a leading apostrophe. Values already
//      starting with an apostrophe are prefixed too, so decoding is
//      unambiguous (exact round-trip either way). Numbers are never guarded —
//      a number can't be a formula, and quoting/prefixing it would break
//      parseFloat on the read side.
//   2. RFC 4180 quoting — any field containing a quote, comma, CR, or LF is
//      double-quoted with embedded quotes doubled. (The old writers quoted
//      only on comma, so an embedded quote or newline in a scraped name could
//      desync columns or inject rows.)
//
// Read side: splitCsvRecords/splitCsvLine (process.mjs) undo the quoting;
// decodeCsvField below strips the formula guard so players.json never picks
// up a leading apostrophe.

const FORMULA_GUARD_RE = /^['=+\-@\t\r]/

export function csvField(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') return String(value)
  let s = String(value)
  if (FORMULA_GUARD_RE.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`
  return s
}

// Inverse of the formula guard, applied after unquoting: strip one leading
// apostrophe when it is followed by a character the guard fires on. Data from
// other sources that legitimately starts with an apostrophe (e.g. an ʻokina
// name like 'Aulola) doesn't match and passes through untouched.
export function decodeCsvField(value) {
  return typeof value === 'string' && FORMULA_GUARD_RE.test(value.slice(1)) && value[0] === "'"
    ? value.slice(1)
    : value
}
