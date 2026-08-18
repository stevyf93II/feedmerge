// csv-url adapter — fetch a CSV over HTTP(S) and return raw records.
//
// The parser is deliberately small and strict (quoted fields, escaped
// quotes, CRLF) rather than a dependency: feeds this tool exists for are
// machine-generated, and a machine-generated CSV that this parser rejects
// is a CSV worth rejecting.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
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

    if (c === '"') {
      if (field !== "") throw new Error(`csv: quote inside unquoted field at index ${i}`);
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 2;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) throw new Error("csv: unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const rec = {};
    header.forEach((h, idx) => {
      rec[h] = cells[idx] ?? "";
    });
    return rec;
  });
}

/**
 * @param {object} config { url, headers? }
 * @returns {Promise<object[]>}
 */
export async function fetchRecords(config) {
  const res = await fetch(config.url, { headers: config.headers ?? {} });
  if (!res.ok) {
    throw new Error(`csv-url: ${config.url} returned ${res.status}`);
  }
  const text = await res.text();
  return parseCsv(text);
}
