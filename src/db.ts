import type { Person } from "./types";

const DB_NAME = "baby-features";
const STORE = "people";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open photo storage"));
  });
}

export async function loadPeople(): Promise<Person[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      const people = (request.result as Person[]).sort((a, b) => a.createdAt - b.createdAt);
      resolve(people);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read saved photos"));
  });
}

export async function savePerson(person: Person): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(person);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not save photos"));
  });
}

export async function deletePerson(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete that person"));
  });
}

export async function clearPeople(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not clear photos"));
  });
}
