import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { peopleFromBackup, peopleToBackup } from "./backup";
import { clearPeople, deletePerson, loadPeople, savePerson } from "./db";
import { countPhotosToRebuild, migratePeople, type MigrateProgress } from "./migrate";
import { requestPersistentStorage } from "./persist";
import { SCHEMA_VERSION, type Person } from "./types";

interface Store {
  people: Person[];
  ready: boolean;
  error: string | null;
  persisted: boolean | null;
  migration: MigrateProgress | null;
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

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [migration, setMigration] = useState<MigrateProgress | null>(null);

  async function remember(next: Person) {
    const stamped = { ...next, schemaVersion: next.schemaVersion ?? SCHEMA_VERSION };
    await savePerson(stamped);
    setPeople((current) => {
      const list = current ?? [];
      const index = list.findIndex((item) => item.id === stamped.id);
      if (index === -1) return [...list, stamped];
      const copy = list.slice();
      copy[index] = stamped;
      return copy;
    });
  }

  async function rebuild(source: Person[], force: boolean) {
    setMigration({ done: 0, total: countPhotosToRebuild(source, force), label: "Updating saved photos…" });
    try {
      const fresh = await migratePeople(source, { force, onProgress: setMigration });
      setPeople(fresh);
    } finally {
      setMigration(null);
    }
  }

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const kept = await requestPersistentStorage();
        if (!cancel) setPersisted(kept);
        const loaded = await loadPeople();
        if (cancel) return;
        if (countPhotosToRebuild(loaded, false) === 0) {
          const stamped = loaded.map((person) => ({ ...person, schemaVersion: SCHEMA_VERSION }));
          for (const person of stamped) {
            if (loaded.find((item) => item.id === person.id)?.schemaVersion !== SCHEMA_VERSION) await savePerson(person);
          }
          if (!cancel) setPeople(stamped);
          return;
        }
        if (!cancel) {
          setPeople(loaded);
          setMigration({
            done: 0,
            total: countPhotosToRebuild(loaded, false),
            label: "Updating saved photos…",
          });
        }
        const fresh = await migratePeople(loaded, { onProgress: (progress) => { if (!cancel) setMigration(progress); } });
        if (!cancel) {
          setPeople(fresh);
          setMigration(null);
        }
      } catch {
        if (!cancel) {
          setError("This browser blocked on-phone storage. Try another browser, or leave private mode, then reload.");
          setPeople([]);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const store = useMemo<Store | null>(() => {
    if (!people) return null;
    return {
      people,
      ready: true,
      error,
      persisted,
      migration,
      baby: people.find((person) => person.kind === "baby") ?? null,
      family: people.filter((person) => person.kind === "family"),
      save: remember,
      async remove(id) {
        await deletePerson(id);
        setPeople((current) => (current ?? []).filter((person) => person.id !== id));
      },
      async reset() {
        await clearPeople();
        setPeople([]);
      },
      async rerun() {
        const current = people;
        await rebuild(current, true);
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
        setPeople(merged);
        await rebuild(merged, false);
      },
    };
  }, [people, error, persisted, migration]);

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
      {migration && migration.total > 0 ? <MigrationNotice progress={migration} /> : null}
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
    <div className="modal" role="status" aria-live="polite">
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
