import { uuidv7 } from 'uuidv7';

/** Time-ordered UUIDv7, used for every primary key and event id. */
export function newId(): string {
  return uuidv7();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
