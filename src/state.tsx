import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearPeople, deletePerson, loadPeople, savePerson } from "./db";
import type { Person } from "./types";

interface Store {
  people: Person[];
  ready: boolean;
  error: string | null;
  baby: Person | null;
  family: Person[];
  save: (person: Person) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: () => Promise<void>;
}

const PeopleContext = createContext<Store | null>(null);

export function PeopleProvider({ children }: { children: ReactNode }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPeople()
      .then(setPeople)
      .catch(() => {
        setError("This browser blocked on-phone storage. Try another browser, or leave private mode, then reload.");
        setPeople([]);
      });
  }, []);

  const store = useMemo<Store | null>(() => {
    if (!people) return null;
    return {
      people,
      ready: true,
      error,
      baby: people.find((person) => person.kind === "baby") ?? null,
      family: people.filter((person) => person.kind === "family"),
      async save(person) {
        await savePerson(person);
        setPeople((current) => {
          const list = current ?? [];
          const index = list.findIndex((item) => item.id === person.id);
          if (index === -1) return [...list, person];
          const next = list.slice();
          next[index] = person;
          return next;
        });
      },
      async remove(id) {
        await deletePerson(id);
        setPeople((current) => (current ?? []).filter((person) => person.id !== id));
      },
      async reset() {
        await clearPeople();
        setPeople([]);
      },
    };
  }, [people, error]);

  if (!store) {
    return (
      <div className="app">
        <p className="muted">Opening photos saved on this phone…</p>
      </div>
    );
  }

  return <PeopleContext.Provider value={store}>{children}</PeopleContext.Provider>;
}

export function usePeople(): Store {
  const store = useContext(PeopleContext);
  if (!store) throw new Error("usePeople must be used inside PeopleProvider");
  return store;
}
