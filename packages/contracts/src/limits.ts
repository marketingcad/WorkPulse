/**
 * Size limits shared by the API schemas and the browser. No zod here: web pages import this file
 * alone (@tallywork/contracts/limits), without the schemas.
 */

/** Longest document logo the API accepts, as a data-URL string (about 150 KB of image). */
export const DOCUMENT_LOGO_MAX_CHARS = 200_000;
