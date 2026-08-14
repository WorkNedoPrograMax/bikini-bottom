// Domain events (AD-2). Every state change is one of these, appended to the
// log in past tense. The snapshot is a pure fold over them (snapshot.ts).
// Story 1.1 only needs the town to exist; later stories add JobHandedOut,
// LaneStartedWorking, PermissionAsked, JobServed, JobBurned, OrderSeen, etc.

import type { CharacterId, CharacterState } from "../../shared/ipc";

export interface BaseEvent {
  /** Monotonic order, assigned by the single writer. */
  seq: number;
  /** ISO-8601 UTC; ordering is by seq, not this. */
  at: string;
}

export interface CharacterRegistered extends BaseEvent {
  type: "CharacterRegistered";
  id: CharacterId;
  name: string;
  role: string;
  accent: string;
  pos: { leftPct: number; topPct: number };
  isHomeBase: boolean;
}

export interface CharacterStateChanged extends BaseEvent {
  type: "CharacterStateChanged";
  id: CharacterId;
  state: CharacterState;
}

export interface JobHandedOut extends BaseEvent {
  type: "JobHandedOut";
  id: CharacterId;
  prompt: string;
}

export interface JobBurned extends BaseEvent {
  type: "JobBurned";
  id: CharacterId;
  reason: string;
}

export interface PermissionAsked extends BaseEvent {
  type: "PermissionAsked";
  id: CharacterId;
}

export interface PermissionAnswered extends BaseEvent {
  type: "PermissionAnswered";
  id: CharacterId;
  allow: boolean;
}

export type DomainEvent =
  | CharacterRegistered | CharacterStateChanged
  | JobHandedOut | JobBurned | PermissionAsked | PermissionAnswered;

/** Event shape before the writer stamps seq + at. */
export type NewEvent =
  | Omit<CharacterRegistered, "seq" | "at">
  | Omit<CharacterStateChanged, "seq" | "at">
  | Omit<JobHandedOut, "seq" | "at">
  | Omit<JobBurned, "seq" | "at">
  | Omit<PermissionAsked, "seq" | "at">
  | Omit<PermissionAnswered, "seq" | "at">;
