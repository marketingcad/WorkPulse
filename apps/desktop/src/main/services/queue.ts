import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SecureStore } from './secure-store';

export interface QueuedEvent {
  event_id: string;
  type: string;
  /** absent for events not tied to a session (e.g. manual time requests) */
  session_id?: string;
  occurred_at: string;
  [k: string]: unknown;
}

/** The queue file of one account (organization + member) on this machine; `null` is the file used before accounts had their own. */
export function queueFileFor(account: string | null): string {
  return account ? `queue-${account.replace(/[^0-9a-z-]/gi, '_')}.log` : 'queue.log';
}

/**
 * Durable, encrypted, append-only offline queue. Every event is fsync'd to disk
 * (one encrypted line per event) BEFORE it is sent, so crashes and network outages
 * never lose tracked time. Acknowledged events are compacted away. Each account has its own
 * file, so events are only ever sent with the credentials of the person who recorded them.
 */
export class OfflineQueue {
  private readonly file: string;
  private events: QueuedEvent[] = [];
  private readonly maxEvents: number;

  constructor(
    private readonly store: SecureStore,
    fileName = 'queue.log',
    maxEvents = 50_000,
  ) {
    this.file = path.join(store.directory, fileName);
    this.maxEvents = maxEvents;
    this.load();
  }

  /**
   * Takes over the events of the file used before accounts had their own (an upgrade): they were
   * recorded by whoever was signed in, which is the account that signs in first afterwards.
   */
  static adoptLegacy(store: SecureStore, fileName: string): void {
    const legacy = path.join(store.directory, queueFileFor(null));
    const target = path.join(store.directory, fileName);
    if (existsSync(legacy) && !existsSync(target)) renameSync(legacy, target);
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    const seen = new Set<string>();
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(this.store.decrypt(line)) as QueuedEvent | { ack: string[] };
        if ('ack' in rec) {
          const acked = new Set((rec as { ack: string[] }).ack);
          this.events = this.events.filter((e) => !acked.has(e.event_id));
        } else if (!seen.has((rec as QueuedEvent).event_id)) {
          seen.add((rec as QueuedEvent).event_id);
          this.events.push(rec as QueuedEvent);
        }
      } catch {
        /* skip a torn final line after a crash */
      }
    }
  }

  get size(): number {
    return this.events.length;
  }

  get full(): boolean {
    return this.events.length >= this.maxEvents;
  }

  push(e: QueuedEvent): void {
    this.events.push(e);
    appendFileSync(this.file, `${this.store.encrypt(JSON.stringify(e))}\n`, { mode: 0o600 });
  }

  /** Whether any unsent event matches. */
  some(match: (e: QueuedEvent) => boolean): boolean {
    return this.events.some(match);
  }

  /** Oldest events first, keeping per-session sequence order. */
  peek(limit: number): QueuedEvent[] {
    return this.events.slice(0, limit);
  }

  ack(ids: string[]): void {
    if (!ids.length) return;
    const set = new Set(ids);
    this.events = this.events.filter((e) => !set.has(e.event_id));
    appendFileSync(this.file, `${this.store.encrypt(JSON.stringify({ ack: ids }))}\n`);
    this.maybeCompact();
  }

  private maybeCompact(): void {
    // Rewrite the log when it only contains acks/garbage relative to live events.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.events.map((e) => `${this.store.encrypt(JSON.stringify(e))}\n`).join(''), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
