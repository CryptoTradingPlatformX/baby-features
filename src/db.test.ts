import { afterEach, describe, expect, it, vi } from "vitest";
import type { Person } from "./types";

/**
 * Safari never completes indexedDB.open once too many connections are left open.
 * This fake does the same from the second open, so a per-save connection hangs.
 */
function installHangingIndexedDB() {
  let opens = 0;
  const records = new Map<string, Person>();
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    onversionchange: null as (() => void) | null,
    transaction() {
      let oncomplete: (() => void) | null = null;
      let onerror: (() => void) | null = null;
      let onabort: (() => void) | null = null;
      const tx = {
        get oncomplete() {
          return oncomplete;
        },
        set oncomplete(fn: (() => void) | null) {
          oncomplete = fn;
        },
        get onerror() {
          return onerror;
        },
        set onerror(fn: (() => void) | null) {
          onerror = fn;
        },
        get onabort() {
          return onabort;
        },
        set onabort(fn: (() => void) | null) {
          onabort = fn;
        },
        error: null,
        objectStore() {
          return {
            getAll() {
              return { result: [...records.values()], error: null };
            },
            put(value: Person) {
              records.set(value.id, value);
              return { result: value.id, error: null };
            },
            delete(id: string) {
              records.delete(id);
              return { result: undefined, error: null };
            },
            clear() {
              records.clear();
              return { result: undefined, error: null };
            },
          };
        },
      };
      queueMicrotask(() => oncomplete?.());
      return tx;
    },
  };

  const factory = {
    open() {
      opens += 1;
      const request: {
        result?: typeof db;
        error: Error | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onupgradeneeded: (() => void) | null;
      } = { error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      if (opens === 1) {
        queueMicrotask(() => {
          request.result = db;
          request.onsuccess?.();
        });
      }
      return request;
    },
  };

  vi.stubGlobal("indexedDB", factory);
  return { get opens() { return opens; } };
}

describe("photo storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps saving after the last photo instead of opening a connection Safari will not finish", async () => {
    const fake = installHangingIndexedDB();
    const { savePerson, loadPeople } = await import("./db");
    const person: Person = {
      id: "baby",
      kind: "baby",
      name: "Baby",
      relationship: "Baby",
      createdAt: 1,
      photos: {},
    };
    const saved = await Promise.race([
      (async () => {
        for (let i = 0; i < 8; i++) await savePerson({ ...person, name: `Baby ${i}` });
        return loadPeople();
      })(),
      new Promise<Person[]>((_, reject) => {
        setTimeout(() => reject(new Error("indexedDB.open hung the way Safari does")), 500);
      }),
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Baby 7");
    expect(fake.opens).toBe(1);
  });
});
