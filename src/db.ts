import type { Person } from "./types";

const DB_NAME = "baby-features";
const STORE = "people";

/**
 * Keep a single connection for the life of the page.
 *
 * Safari stops completing `indexedDB.open` after a handful of connections are
 * left open, and it never calls success or error. Migration used to open a new
 * connection for every photo and then open more after the counter had already
 * reached N/N, so the progress overlay stayed up and taps did nothing.
 */
let cached: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!cached) {
    cached = openDb().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open photo storage"));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        if (typeof request.addEventListener === "function") {
          request.addEventListener("error", (event) => event.preventDefault());
        }
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };
        tx.oncomplete = () => finish(() => resolve(request.result));
        tx.onerror = () => finish(() => reject(tx.error ?? request.error ?? new Error("Could not use photo storage")));
        tx.onabort = () => finish(() => reject(tx.error ?? new Error("Photo storage was interrupted")));
      }),
  );
}

export async function loadPeople(): Promise<Person[]> {
  const people = await run<Person[]>("readonly", (store) => store.getAll());
  return people.sort((a, b) => a.createdAt - b.createdAt);
}

export function savePerson(person: Person): Promise<void> {
  return run("readwrite", (store) => store.put(person)).then(() => undefined);
}

export function deletePerson(id: string): Promise<void> {
  return run("readwrite", (store) => store.delete(id)).then(() => undefined);
}

export function clearPeople(): Promise<void> {
  return run("readwrite", (store) => store.clear()).then(() => undefined);
}
