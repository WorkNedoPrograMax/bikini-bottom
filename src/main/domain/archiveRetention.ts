// How long a finished conversation stays in a character's "past orders".
//
// 2026-11-04: Maksym asked for a cap — "keep an inactive conversation for a
// month, delete everything older". Each character's archive had grown to 37
// conversations (25 MB over two towns, 10 MB of it picture thumbnails) with no
// end in sight. A conversation is stamped when it is archived (that is the
// moment it went quiet — a new order replaced it) and dropped 30 days later.
// Conversations saved before this change carry no date: they are stamped at
// the first load that sees them and start their 30 days from there, never
// dropped on a guess. Pure, so the check script can run it.

export const ARCHIVE_KEEP_DAYS = 30;
export const ARCHIVE_KEEP_MS = ARCHIVE_KEEP_DAYS * 24 * 60 * 60 * 1000;

export interface Dated { endedAt?: number }

/** Give every undated conversation today's date (in place), return the count stamped. */
export function stampArchive<T extends Dated>(archive: T[], now: number): number {
  let n = 0;
  for (const s of archive) if (!(typeof s.endedAt === "number" && s.endedAt > 0)) { s.endedAt = now; n++; }
  return n;
}

/** The conversations still inside the window, oldest first as stored, plus how
 *  many fell out. An undated one is never dropped (stamp first). */
export function pruneArchive<T extends Dated>(archive: T[], now: number, keepMs: number = ARCHIVE_KEEP_MS): { kept: T[]; dropped: number } {
  const kept = archive.filter((s) => !(typeof s.endedAt === "number" && s.endedAt > 0) || now - s.endedAt <= keepMs);
  return { kept, dropped: archive.length - kept.length };
}
