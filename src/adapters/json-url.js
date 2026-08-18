// json-url adapter — fetch a JSON array (or an object containing one) over
// HTTP(S) and return raw records.

/**
 * @param {object} config { url, headers?, path? }
 *   path: dot-path into the response when the array isn't the root,
 *         e.g. "data.items"
 * @returns {Promise<object[]>}
 */
export async function fetchRecords(config) {
  const res = await fetch(config.url, { headers: config.headers ?? {} });
  if (!res.ok) {
    throw new Error(`json-url: ${config.url} returned ${res.status}`);
  }
  let body = await res.json();

  if (config.path) {
    for (const part of config.path.split(".")) {
      body = body?.[part];
    }
  }

  if (!Array.isArray(body)) {
    throw new Error(
      `json-url: expected an array${config.path ? ` at "${config.path}"` : ""}, got ${typeof body}`
    );
  }
  return body;
}
