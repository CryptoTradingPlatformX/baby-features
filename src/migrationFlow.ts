import type { MigrateProgress } from "./migrate";
import type { Person } from "./types";

export interface Landing {
  id: number;
  to: "results" | "home";
}

/** What the screen should show across a saved-photo rebuild. */
export interface MigrationView {
  people: Person[] | null;
  migration: MigrateProgress | null;
  error: string | null;
  canRetry: boolean;
  /** Set once this pass has finished or failed, so a late progress event cannot bring the overlay back. */
  settled: boolean;
  landing: Landing | null;
}

export const MIGRATION_FAILED = "Couldn't finish updating the saved photos. Your photos are still here. Try again.";

export function viewBooting(): MigrationView {
  return { people: null, migration: null, error: null, canRetry: false, settled: false, landing: null };
}

export function destinationFor(people: Person[]): "results" | "home" {
  const baby = people.some((person) => person.kind === "baby");
  const family = people.some((person) => person.kind === "family");
  return baby && family ? "results" : "home";
}

export function showSavedPeople(view: MigrationView, people: Person[]): MigrationView {
  return { ...view, people, migration: null, settled: true };
}

export function startMigration(view: MigrationView, people: Person[], progress: MigrateProgress): MigrationView {
  return { ...view, people, migration: progress, error: null, canRetry: false, settled: false };
}

export function noteMigrationProgress(view: MigrationView, progress: MigrateProgress): MigrationView {
  if (view.settled) return view;
  return { ...view, migration: progress };
}

export function failureNote(failures: string[]): string | null {
  if (!failures.length) return null;
  const shown = failures.slice(0, 3).join(", ");
  const extra = failures.length > 3 ? `, and ${failures.length - 3} more` : "";
  return `Couldn't update ${shown}${extra}. The saved photos are still here.`;
}

/**
 * The rebuild promise resolved. Drop the blocking overlay and, when this was
 * a real rebuild, move to a screen the user can act on.
 */
export function finishMigration(view: MigrationView, people: Person[], failures: string[], navigate: boolean): MigrationView {
  const note = failureNote(failures);
  return {
    people,
    migration: null,
    error: note,
    canRetry: Boolean(note),
    settled: true,
    landing: navigate ? { id: (view.landing?.id ?? 0) + 1, to: destinationFor(people) } : view.landing,
  };
}

/** The rebuild threw. Same rule: the overlay must not stay up, and the photos stay. */
export function failMigration(view: MigrationView, people: Person[], message: string, canRetry: boolean): MigrationView {
  return {
    people,
    migration: null,
    error: message,
    canRetry,
    settled: true,
    landing: { id: (view.landing?.id ?? 0) + 1, to: "home" },
  };
}
