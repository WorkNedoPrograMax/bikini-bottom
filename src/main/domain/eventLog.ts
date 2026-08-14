// The event log (AD-2): a SINGLE serialized writer, total order via monotonic
// `seq`, each event persisted (append-only JSONL) BEFORE its effect is
// acknowledged. Concurrent append() calls are queued so two Lanes can never
// interleave and corrupt the log.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { DomainEvent, NewEvent } from "./events";

export class EventLog {
  private readonly file: string;
  private seq = 0;
  private events: DomainEvent[] = [];
  /** Serialization chain — every append awaits the previous one. */
  private tail: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "event-log.jsonl");
  }

  /** Load existing events on boot; replay is side-effect-free (AD-2). */
  async load(): Promise<void> {
    let raw = "";
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return; // fresh install — no log yet
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const ev = JSON.parse(trimmed) as DomainEvent;
      this.events.push(ev);
      if (ev.seq > this.seq) this.seq = ev.seq;
    }
  }

  /** Append one event; resolves only after it is durably on disk. */
  append(ev: NewEvent): Promise<DomainEvent> {
    const run = this.tail.then(async () => {
      const stamped = { ...ev, seq: ++this.seq, at: new Date().toISOString() } as DomainEvent;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, JSON.stringify(stamped) + "\n", "utf8");
      this.events.push(stamped);
      return stamped;
    });
    // Keep the chain alive even if one append rejects.
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  all(): readonly DomainEvent[] {
    return this.events;
  }

  get lastSeq(): number {
    return this.seq;
  }
}
