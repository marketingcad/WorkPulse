/** A case-insensitive `contains` pattern for ILIKE, with the LIKE wildcards in the search term escaped. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Whether a path parameter is a UUID, so a malformed id is a 404 rather than a database error. */
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
