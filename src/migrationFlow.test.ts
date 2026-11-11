import { describe, expect, it } from "vitest";
import type { Person } from "./types";
import {
  failMigration,
  finishMigration,
  MIGRATION_FAILED,
  noteMigrationProgress,
  showSavedPeople,
  startMigration,
  viewBooting,
} from "./migrationFlow";

const family: Person[] = [
  { id: "baby", kind: "baby", name: "Baby", relationship: "Baby", createdAt: 1, photos: {} },
  { id: "mom", kind: "family", name: "Mom", relationship: "Mom", createdAt: 2, photos: {} },
  { id: "dad", kind: "family", name: "Dad", relationship: "Dad", createdAt: 3, photos: {} },
];

describe("migration completion", () => {
  it("drops the blocking overlay and opens the comparison when the last photo finishes", () => {
    let view = startMigration(viewBooting(), family, { done: 0, total: 6, label: "Updating saved photos…" });
    view = noteMigrationProgress(view, { done: 6, total: 6, label: "Dad · right side" });
    expect(view.migration).toEqual({ done: 6, total: 6, label: "Dad · right side" });

    view = finishMigration(view, family, [], true);
    expect(view.migration).toBeNull();
    expect(view.settled).toBe(true);
    expect(view.landing).toEqual({ id: 1, to: "results" });
    expect(view.people).toHaveLength(3);
    expect(view.error).toBeNull();

    view = noteMigrationProgress(view, { done: 6, total: 6, label: "late model progress" });
    expect(view.migration).toBeNull();
    expect(view.landing?.to).toBe("results");
  });

  it("clears the overlay, keeps every person, and offers a retry when the rebuild fails", () => {
    let view = startMigration(viewBooting(), family, { done: 0, total: 6, label: "Updating saved photos…" });
    view = noteMigrationProgress(view, { done: 6, total: 6, label: "Dad · right side" });
    view = failMigration(view, family, MIGRATION_FAILED, true);

    expect(view.migration).toBeNull();
    expect(view.people?.map((person) => person.name)).toEqual(["Baby", "Mom", "Dad"]);
    expect(view.canRetry).toBe(true);
    expect(view.error).toMatch(/still here/);
    expect(view.landing?.to).toBe("home");

    view = noteMigrationProgress(view, { done: 6, total: 6, label: "late" });
    expect(view.migration).toBeNull();
  });

  it("does not navigate away when saved photos were already current", () => {
    const view = showSavedPeople(viewBooting(), family);
    const finished = finishMigration(view, family, [], false);
    expect(finished.migration).toBeNull();
    expect(finished.landing).toBeNull();
    expect(finished.people).toEqual(family);
  });
});
