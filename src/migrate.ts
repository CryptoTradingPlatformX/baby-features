import { ANALYSIS_VERSION, SCHEMA_VERSION, type Angle, type Person, type PhotoAnalysis, type StoredPhoto } from "./types";
import { savePerson } from "./db";
import { releaseCanvas } from "./vision/imageutil";

const ANGLES: Angle[] = ["front", "left", "right"];

export interface MigrateProgress {
  done: number;
  total: number;
  label: string;
}

export interface MigrateOutcome {
  people: Person[];
  failures: string[];
}

export interface MigrateDeps {
  analyze: (blob: Blob, angle: Angle) => Promise<{ analysis: PhotoAnalysis; canvas?: HTMLCanvasElement }>;
  save: (person: Person) => Promise<void>;
  subscribe?: (listener: (model: { ratio: number; label: string }) => void) => () => void;
}

export function analysisIsStale(analysis: PhotoAnalysis | null | undefined): boolean {
  if (!analysis || analysis.version !== ANALYSIS_VERSION) return true;
  if (!Array.isArray(analysis.features)) return true;
  return analysis.features.some((feature) => !Array.isArray(feature.shape));
}

export function photosToRebuild(person: Person, force: boolean): Angle[] {
  const angles: Angle[] = [];
  for (const angle of ANGLES) {
    const photo = person.photos[angle];
    if (!photo?.blob) continue;
    if (force || analysisIsStale(photo.analysis)) angles.push(angle);
  }
  return angles;
}

export function countPhotosToRebuild(people: Person[], force: boolean): number {
  return people.reduce((sum, person) => sum + photosToRebuild(person, force).length, 0);
}

let depsPromise: Promise<MigrateDeps> | null = null;

function productionDeps(): Promise<MigrateDeps> {
  if (!depsPromise) {
    depsPromise = Promise.all([import("./vision/analyze"), import("./vision/engine")])
      .then(([analyze, engine]) => ({
        async analyze(blob: Blob, angle: Angle) {
          const result = await analyze.analyzePhotoBlob(blob, angle);
          releaseCanvas(result.canvas);
          return result;
        },
        save: savePerson,
        subscribe: engine.subscribeModel,
      }))
      .catch((error) => {
        depsPromise = null;
        throw error;
      });
  }
  return depsPromise;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Re-measure saved photos whose analysis is older than the current pipeline.
 * The original photo blobs and the people themselves are kept.
 * Each photo is saved once. A second write after the counter finishes is what
 * left Safari stuck on "N of N".
 */
export async function migratePeople(
  people: Person[],
  options: {
    force?: boolean;
    onProgress?: (progress: MigrateProgress) => void;
    shouldContinue?: () => boolean;
    deps?: MigrateDeps;
  } = {},
): Promise<MigrateOutcome> {
  const force = options.force ?? false;
  const jobs = people.flatMap((person) =>
    photosToRebuild(person, force).map((angle) => ({ personId: person.id, name: person.name, angle })),
  );
  const report = (done: number, label: string) => options.onProgress?.({ done, total: jobs.length, label });
  report(0, jobs.length ? "Updating saved photos…" : "Saved photos are already up to date");

  let deps: MigrateDeps;
  try {
    deps = options.deps ?? (await productionDeps());
  } catch {
    return {
      people,
      failures: jobs.map((job) => `${job.name} · ${angleLabel(job.angle)}`),
    };
  }

  const current = new Map<string, Person>(people.map((person) => [person.id, { ...person, photos: { ...person.photos } }]));
  const failed = new Set<string>();
  const failures: string[] = [];
  let done = 0;

  for (const job of jobs) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    await yieldToBrowser();
    const person = current.get(job.personId);
    const photo = person?.photos[job.angle];
    const label = `${job.name} · ${angleLabel(job.angle)}`;
    if (!person || !photo) {
      done += 1;
      report(done, label);
      continue;
    }
    report(done, label);
    const stop =
      deps.subscribe?.((model) => {
        if (model.ratio > 0 && model.ratio < 1) report(done, `${label}. ${model.label} ${Math.round(model.ratio * 100)}%`);
      }) ?? (() => {});
    try {
      const { analysis } = await deps.analyze(photo.blob, job.angle);
      const next = stamp(person, job.angle, photo, analysis);
      await deps.save(next);
      current.set(person.id, next);
    } catch {
      failed.add(job.personId);
      failures.push(label);
      report(done, `Could not update ${label}. The saved photo is still here.`);
    } finally {
      stop();
    }
    done += 1;
    report(done, label);
  }

  const result = people.map((person) => {
    const updated = current.get(person.id) ?? person;
    if (failed.has(person.id)) return updated;
    return { ...updated, schemaVersion: SCHEMA_VERSION };
  });
  await yieldToBrowser();
  return { people: result, failures };
}

function stamp(person: Person, angle: Angle, photo: StoredPhoto, analysis: PhotoAnalysis): Person {
  return {
    ...person,
    schemaVersion: SCHEMA_VERSION,
    photos: {
      ...person.photos,
      [angle]: { ...photo, analysis },
    },
  };
}

function angleLabel(angle: Angle): string {
  if (angle === "front") return "front";
  if (angle === "left") return "left side";
  return "right side";
}
