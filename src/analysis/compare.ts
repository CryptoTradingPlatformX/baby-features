import type { AnalyzedFeature, FeatureId, Person } from "../types";
import { FEATURES, featureMeta, type FeatureNeed } from "../types";
import {
  decideShares,
  driverLabel,
  featureDistances,
  shareSentence,
  type DistanceParts,
  type Driver,
} from "./score";

export interface ScoreRow {
  personId: string;
  name: string;
  relationship: string;
  /** Share of this feature across the relatives who could be compared. Null when there is only one. */
  score: number;
  share: number | null;
  shapeDistance: number | null;
  appearanceDistance: number | null;
  contourDistance: number | null;
  ratioDistance: number | null;
  combinedDistance: number;
}

export interface FeatureComparison {
  id: FeatureId;
  label: string;
  sentence: string;
  ranked: ScoreRow[];
  unavailable: { name: string; reason: string }[];
  babyMissing: boolean;
  babyCrop: AnalyzedFeature | null;
  tooClose: boolean;
  driver: Driver;
  driverText: string;
  yardstick: number | null;
}

export interface OverallRow {
  personId: string;
  name: string;
  relationship: string;
  score: number;
  wins: number;
  compared: number;
}

export interface Comparison {
  features: FeatureComparison[];
  overall: OverallRow[];
  headline: string;
  tally: string;
}

const OVERALL_WEIGHT: Record<FeatureId, number> = {
  faceShape: 0.85,
  forehead: 0.7,
  eyebrows: 1,
  eyes: 1.35,
  nose: 1.25,
  lips: 1.1,
  chin: 1,
  cheeks: 0.8,
  leftEar: 1.5,
  rightEar: 1.5,
  noseProfile: 1.05,
  chinProfile: 0.95,
};

export function featuresById(person: Person): Map<FeatureId, AnalyzedFeature> {
  const map = new Map<FeatureId, AnalyzedFeature>();
  for (const angle of ["front", "left", "right"] as const) {
    const photo = person.photos[angle];
    if (!photo?.analysis) continue;
    for (const feature of photo.analysis.features) {
      const previous = map.get(feature.id);
      if (!previous || feature.confidence > previous.confidence) map.set(feature.id, feature);
    }
  }
  return map;
}

export function compareFamily(baby: Person, family: Person[]): Comparison {
  const babyFeatures = featuresById(baby);
  const familyFeatures = family.map((person) => ({ person, features: featuresById(person) }));
  const wins = new Map<string, number>();
  for (const entry of familyFeatures) wins.set(entry.person.id, 0);

  const features: FeatureComparison[] = FEATURES.map((meta) => {
    const babyFeature = babyFeatures.get(meta.id) ?? null;
    const unavailable: { name: string; reason: string }[] = [];
    if (!babyFeature) {
      return emptyFeature(meta.id, meta.label, true, unavailable);
    }

    const candidates: { person: Person; feature: AnalyzedFeature; distances: DistanceParts }[] = [];
    for (const entry of familyFeatures) {
      const theirs = entry.features.get(meta.id);
      if (!theirs || theirs.confidence < 0.4 || babyFeature.confidence < 0.4) {
        unavailable.push({
          name: entry.person.name,
          reason: !theirs ? missingReason(entry.person, meta.needs, meta.label) : "Not clear enough in the photo",
        });
        continue;
      }
      const distances = featureDistances(meta.id, babyFeature, theirs);
      if (!distances) {
        unavailable.push({ name: entry.person.name, reason: "Not clear enough in the photo" });
        continue;
      }
      candidates.push({ person: entry.person, feature: theirs, distances });
    }

    const adultDistances: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const between = featureDistances(meta.id, candidates[i].feature, candidates[j].feature);
        if (between) adultDistances.push(between.combined);
      }
    }
    const decision = decideShares(meta.id, candidates.map((row) => row.distances), adultDistances);
    const ranked: ScoreRow[] = candidates.map((row, index) => ({
      personId: row.person.id,
      name: row.person.name,
      relationship: row.person.relationship,
      share: decision.shares[index] ?? null,
      score: decision.shares[index] ?? 0,
      shapeDistance: row.distances.shape,
      appearanceDistance: row.distances.appearance,
      contourDistance: row.distances.contour,
      ratioDistance: row.distances.ratio,
      combinedDistance: row.distances.combined,
    }));
    ranked.sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.combinedDistance - b.combinedDistance);

    if (!decision.tooClose && ranked.length >= 1 && ranked[0].share !== null) {
      wins.set(ranked[0].personId, (wins.get(ranked[0].personId) ?? 0) + 1);
    } else if (ranked.length === 1) {
      wins.set(ranked[0].personId, (wins.get(ranked[0].personId) ?? 0) + 1);
    }

    return {
      id: meta.id,
      label: meta.label,
      sentence: ranked.length ? shareSentence(meta.label, ranked, decision.tooClose) : `${meta.label}: not enough photos`,
      ranked,
      unavailable,
      babyMissing: false,
      babyCrop: babyFeature,
      tooClose: decision.tooClose,
      driver: decision.driver,
      driverText: driverLabel(decision.driver),
      yardstick: decision.yardstick,
    };
  });

  const masses = familyFeatures.map(({ person }) => {
    let mass = 0;
    let compared = 0;
    for (const feature of features) {
      const row = feature.ranked.find((item) => item.personId === person.id);
      if (!row || row.share == null) continue;
      mass += OVERALL_WEIGHT[feature.id] * row.share;
      compared++;
    }
    return { person, mass, compared, wins: wins.get(person.id) ?? 0 };
  }).filter((row) => row.compared > 0);

  const totalMass = masses.reduce((sum, row) => sum + row.mass, 0) || 1;
  const overall: OverallRow[] = masses
    .map((row) => ({
      personId: row.person.id,
      name: row.person.name,
      relationship: row.person.relationship,
      score: row.mass / totalMass,
      wins: row.wins,
      compared: row.compared,
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  return {
    features,
    overall,
    headline: overallHeadline(baby.name, overall),
    tally: tallyLine(overall),
  };
}

function emptyFeature(id: FeatureId, label: string, babyMissing: boolean, unavailable: { name: string; reason: string }[]): FeatureComparison {
  return {
    id,
    label,
    sentence: `${label}: not enough photos`,
    ranked: [],
    unavailable,
    babyMissing,
    babyCrop: null,
    tooClose: false,
    driver: "none",
    driverText: driverLabel("none"),
    yardstick: null,
  };
}

function overallHeadline(babyName: string, overall: OverallRow[]): string {
  if (!overall.length) return `Add family photos to see who ${babyName} resembles.`;
  if (overall.length === 1) return `${babyName} can only be compared with ${overall[0].name} so far.`;
  const [first, second] = overall;
  if (first.score - second.score < 0.06) {
    return `${babyName} is too close to call between ${first.name} and ${second.name}.`;
  }
  const byWins = [...overall].sort((a, b) => b.wins - a.wins || b.score - a.score);
  if (byWins[0].personId !== first.personId && byWins[0].wins > first.wins) {
    return `${babyName} shares the most features with ${byWins[0].name}. ${first.name} has the higher share on fewer photos (${Math.round(first.score * 100)}%).`;
  }
  return `${babyName} resembles ${first.name} most overall (${Math.round(first.score * 100)}%).`;
}

function tallyLine(overall: OverallRow[]): string {
  const leaders = [...overall].filter((row) => row.wins > 0).sort((a, b) => b.wins - a.wins);
  if (!leaders.length) return "No feature has a clear lead yet.";
  return leaders.map((row) => `${row.name} leads in ${row.wins} feature${row.wins === 1 ? "" : "s"}`).join(", ") + ".";
}

export function missingReason(person: Person, needs: FeatureNeed, label: string): string {
  if (needs === "front" && !person.photos.front) return "Not enough photos";
  if (needs === "left" && !person.photos.left) return "Not enough photos";
  if (needs === "right" && !person.photos.right) return "Not enough photos";
  if (needs === "profile" && !person.photos.left && !person.photos.right) return "Not enough photos";
  return `${label} wasn't clear enough in the photo`;
}

export function babyNeed(needs: FeatureNeed): string {
  if (needs === "front") return "Add a front photo";
  if (needs === "left") return "Add a left side photo";
  if (needs === "right") return "Add a right side photo";
  return "Add a side photo";
}

export function photoSupports(angle: "front" | "left" | "right", id: FeatureId): boolean {
  const needs = featureMeta(id).needs;
  if (needs === "profile") return angle === "left" || angle === "right";
  return needs === angle;
}
