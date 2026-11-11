import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { peopleFromBackup, peopleToBackup } from "./backup";
import { clearPeople, deletePerson, loadPeople, savePerson } from "./db";
import { countPhotosToRebuild, migratePeople, type MigrateProgress } from "./migrate";
import {
  failMigration,
  finishMigration,
  MIGRATION_FAILED,
  noteMigrationProgress,
  showSavedPeople,
  startMigration,
  viewBooting,
  type MigrationView,
} from "./migrationFlow";
import { requestPersistentStorage } from "./persist";
import { SCHEMA_VERSION, type Person } from "./types";

interface Store {
  people: Person[];
  ready: boolean;
  error: string | null;
  canRetry: boolean;
  persisted: boolean | null;
  migration: MigrateProgress | null;
  landing: MigrationView["landing"];
  baby: Person | null;
  family: Person[];
  save: (person: Person) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => Promise<void>;
  rerun: () => Promise<void>;
  exportBackup: () => Promise<void>;
  importBackup: (file: File) => Promise<void>;
}

const PeopleContext = createContext<Store | null>(null);
const STORAGE_BLOCKED = "This browser blocked on-phone storage. Try another browser, or leave private mode, then reload.";

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<MigrationView>(viewBooting);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  function replacePeople(list: Person[]) {
    setView((current) => ({ ...current, people: list }));
  }

  async function remember(next: Person) {
    const stamped = { ...next, schemaVersion: next.schemaVersion ?? SCHEMA_VERSION };
    await savePerson(stamped);
    setView((current) => {
      const list = current.people ?? [];
      const index = list.findIndex((item) => item.id === stamped.id);
      const people = index === -1 ? [...list, stamped] : list.map((item, i) => (i === index ? stamped : item));
      return { ...current, people };
    });
  }

  async function rebuild(source: Person[], force: boolean) {
    const total = countPhotosToRebuild(source, force);
    setView((current) => startMigration(current, source, { done: 0, total, label: "Updating saved photos…" }));
    try {
      const outcome = await migratePeople(source, {
        force,
        onProgress: (progress) => setView((current) => noteMigrationProgress(current, progress)),
      });
      setView((current) => finishMigration(current, outcome.people, outcome.failures, total > 0));
    } catch {
      setView((current) => failMigration(current, current.people ?? source, MIGRATION_FAILED, true));
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      let loaded: Person[] | null = null;
      try {
        const kept = await requestPersistentStorage();
        if (active) setPersisted(kept);
        const saved = await loadPeople();
        loaded = saved;
        if (!active) return;
        if (countPhotosToRebuild(saved, false) === 0) {
          const stamped = saved.map((person) => ({ ...person, schemaVersion: SCHEMA_VERSION }));
          for (const person of stamped) {
            if (saved.find((item) => item.id === person.id)?.schemaVersion !== SCHEMA_VERSION) await savePerson(person);
          }
          if (active) setView((current) => showSavedPeople(current, stamped));
          return;
        }
        if (active) {
          setView((current) =>
            startMigration(current, saved, {
              done: 0,
              total: countPhotosToRebuild(saved, false),
              label: "Updating saved photos…",
            }),
          );
        }
        const outcome = await migratePeople(saved, {
          shouldContinue: () => active,
          onProgress: (progress) => {
            if (active) setView((current) => noteMigrationProgress(current, progress));
          },
        });
        if (!active) return;
        setView((current) => finishMigration(current, outcome.people, outcome.failures, true));
      } catch {
        if (!active) return;
        const fallback = loaded;
        if (fallback) setView((current) => failMigration(current, current.people ?? fallback, MIGRATION_FAILED, true));
        else setView((current) => failMigration(current, [], STORAGE_BLOCKED, false));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const people = view.people;
  const store = useMemo<Store | null>(() => {
    if (!people) return null;
    return {
      people,
      ready: true,
      error: view.error,
      canRetry: view.canRetry,
      persisted,
      migration: view.migration,
      landing: view.landing,
      baby: people.find((person) => person.kind === "baby") ?? null,
      family: people.filter((person) => person.kind === "family"),
      save: remember,
      async remove(id) {
        await deletePerson(id);
        setView((current) => ({ ...current, people: (current.people ?? []).filter((person) => person.id !== id) }));
      },
      async reset() {
        await clearPeople();
        replacePeople([]);
      },
      async rerun() {
        await rebuild(people, true);
      },
      async exportBackup() {
        const backup = await peopleToBackup(people);
        const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "baby-features-backup.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      async importBackup(file) {
        const text = await file.text();
        const imported = await peopleFromBackup(text);
        for (const person of imported) await savePerson(person);
        const merged = mergePeople(people, imported);
        await rebuild(merged, false);
      },
    };
  }, [people, view.error, view.canRetry, view.migration, view.landing, persisted]);

  if (!store) {
    return (
      <div className="app">
        <p className="muted">Opening photos saved on this phone…</p>
      </div>
    );
  }

  return (
    <PeopleContext.Provider value={store}>
      {children}
      {view.migration && view.migration.total > 0 ? <MigrationNotice progress={view.migration} /> : null}
    </PeopleContext.Provider>
  );
}

export function usePeople(): Store {
  const store = useContext(PeopleContext);
  if (!store) throw new Error("usePeople must be used inside PeopleProvider");
  return store;
}

function mergePeople(existing: Person[], imported: Person[]): Person[] {
  const map = new Map(existing.map((person) => [person.id, person]));
  for (const person of imported) map.set(person.id, person);
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function MigrationNotice({ progress }: { progress: MigrateProgress }) {
  const ratio = progress.total ? progress.done / progress.total : 0;
  return (
    <div className="modal" role="status" aria-live="polite" data-testid="migration-notice">
      <div className="card">
        <h2>Updating saved photos</h2>
        <p>{progress.label}</p>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${Math.round(ratio * 100)}%` }} />
          <span>
            {progress.done} of {progress.total}
          </span>
        </div>
        <p className="note">The photos stay on this phone. Only the measurements are rebuilt.</p>
      </div>
    </div>
  );
}
