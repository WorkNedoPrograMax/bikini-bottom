// Seats: how many characters of one town may be working at once (2026-11-26).
//
// WHY. Every working character re-sends its whole memory on each call, and all
// of them draw on the same Claude account. With five characters cooking at once
// the account's limit and the spend grow together; two at a time is what the
// work actually needs. A third order is not refused — it waits, visibly, and
// starts by itself the moment a seat frees up (first come, first served).
//
// PURE, so scripts/check-seats.mjs can run it without a lane.

/** Two working characters per town unless the town's town.json says `seats`. */
export const DEFAULT_SEATS = 2;
/** What the working strip says while an order waits. */
export const SEAT_WAIT_ACTIVITY = "🪑 waiting for a free seat — another character is working; I start by myself the moment one frees up";

/** The town's seat count from its town.json value: a whole number ≥ 1, else the default. */
export function normalizeSeats(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_SEATS;
}

export interface SeatLane {
  id: string;
  /** Mid-turn or settling after one. */
  busy: boolean;
  /** Waiting on Maksym (a question or a permission): not using a seat. */
  waitingOnMaksym: boolean;
  /** Queued for a seat (epoch ms it started waiting), or 0. */
  seatSince: number;
}

/** How many seats are taken right now. */
export function seatsTaken(lanes: readonly SeatLane[]): number {
  return lanes.filter((l) => l.busy && !l.waitingOnMaksym && !l.seatSince).length;
}

/** May `id` start working now? A lane already working keeps its seat. */
export function seatFree(id: string, lanes: readonly SeatLane[], seats: number): boolean {
  const me = lanes.find((l) => l.id === id);
  if (me && me.busy && !me.seatSince) return true;
  return seatsTaken(lanes.filter((l) => l.id !== id)) < seats;
}

/** Who gets the freed seats, oldest wait first. */
export function admitOrder(lanes: readonly SeatLane[], seats: number): string[] {
  const free = Math.max(0, seats - seatsTaken(lanes));
  return lanes.filter((l) => l.seatSince > 0).sort((a, b) => a.seatSince - b.seatSince).slice(0, free).map((l) => l.id);
}
