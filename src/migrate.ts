import { ANALYSIS_VERSION, SCHEMA_VERSION, type Angle, type Person, type PhotoAnalysis, type StoredPhoto } from "./types";
import { savePerson } from "./db";

const ANGLES: Angle[] = ["front", "left", "right"];

export interface MigrateProgress {
  done: number;
  total: number;
  label: string;
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

/**
 * Re-measure saved photos whose analysis is older than the current pipeline.
 * The original photo blobs and the people themselves are kept.
 */
export async function migratePeople(
  people: Person[],
  options: { force?: boolean; onProgress?: (progress: MigrateProgress) => void },
): Promise<Person[]> {
  const force = options.force ?? false;
  const jobs = people.flatMap((person) => photosToRebuild(person, force).map((angle) => ({ personId: person.id, name: person.name, angle })));
  options.onProgress?.({
    done: 0,
    total: jobs.length,
    label: jobs.length ? "Updating saved photos…" : "Saved photos are already up to date",
  });

  const current = new Map<string, Person>(people.map((person) => [person.id, { ...person, photos: { ...person.photos } }]));
  const failed = new Set<string>();
  let done = 0;
  const { analyzePhotoBlob } = await import("./vision/analyze");
  const { subscribeModel } = await import("./vision/engine");

  for (const job of jobs) {
    const person = current.get(job.personId);
    const photo = person?.photos[job.angle];
    if (!person || !photo) continue;
    const label = `${job.name} · ${angleLabel(job.angle)}`;
    options.onProgress?.({ done, total: jobs.length, label });
    const stop = subscribeModel((model) => {
      if (model.ratio > 0 && model.ratio < 1) {
        options.onProgress?.({
          done,
          total: jobs.length,
          label: `${label}. ${model.label} ${Math.round(model.ratio * 100)}%`,
        });
      }
    });
    try {
      const { analysis } = await analyzePhotoBlob(photo.blob, job.angle);
      const next = stamp(person, job.angle, photo, analysis);
      current.set(person.id, next);
      await savePerson(next);
    } catch {
      failed.add(job.personId);
      options.onProgress?.({
        done,
        total: jobs.length,
        label: `Could not update ${label}. The saved photo is still here.`,
      });
    } finally {
      stop();
    }
    done += 1;
    options.onProgress?.({ done, total: jobs.length, label });
  }

  const result: Person[] = [];
  for (const person of people) {
    const updated = current.get(person.id) ?? person;
    const stamped = {
      ...updated,
      schemaVersion: failed.has(person.id) ? person.schemaVersion : SCHEMA_VERSION,
    };
    if (stamped.schemaVersion !== person.schemaVersion || jobs.some((job) => job.personId === person.id)) {
      await savePerson(stamped);
    }
    result.push(stamped);
  }
  return result;
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
