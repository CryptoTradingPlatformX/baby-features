import type { AnalyzedFeature, FeatureId, Person } from "../types";
import { FEATURES, featureMeta, type FeatureNeed } from "../types";
import { appearanceScore, cosine, geometryScore } from "./math";

export interface ScoreRow {
  personId: string;
  name: string;
  relationship: string;
  score: number;
}

export interface FeatureComparison {
  id: FeatureId;
  label: string;
  sentence: string;
  ranked: ScoreRow[];
  unavailable: { name: string; reason: string }[];
  babyMissing: boolean;
  babyCrop: AnalyzedFeature | null;
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
  faceShape: 0.7,
  forehead: 0.65,
  eyebrows: 1,
  eyes: 1.3,
  nose: 1.2,
  lips: 1.1,
  chin: 0.9,
  cheeks: 0.75,
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

export function featureScore(baby: AnalyzedFeature, other: AnalyzedFeature): number | null {
  if (baby.id !== other.id) return null;
  if (baby.confidence < 0.4 || other.confidence < 0.4) return null;
  const parts: { weight: number; score: number }[] = [];
  const ear = baby.id === "leftEar" || baby.id === "rightEar";

  if (baby.appearance.length && other.appearance.length) {
    parts.push({
      weight: ear ? 0.62 : 0.55,
      score: appearanceScore(cosine(baby.appearance, other.appearance)),
    });
  }
  if (baby.geometry.length && baby.geometry.length === other.geometry.length) {
    parts.push({
      weight: ear ? 0.15 : 0.45,
      score: geometryScore(baby.geometry, other.geometry),
    });
  }
  if (ear && baby.contour.length && other.contour.length) {
    parts.push({
      weight: 0.23,
      score: appearanceScore(cosine(baby.contour, other.contour)),
    });
  }
  if (!parts.length) return null;
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.reduce((sum, part) => sum + part.weight * part.score, 0) / weight;
  return clamp01(score);
}

export function rankingSentence(label: string, ranking: { name: string; score: number }[]): string {
  if (!ranking.length) return `${label}: not enough photos`;
  const pct = (score: number) => `${Math.round(score * 100)}%`;
  const [first, second, ...rest] = ranking;
  if (!second) return `${label}: most like ${first.name} (${pct(first.score)})`;
  if (first.score - second.score < 0.03) {
    return `${label}: ${first.name} and ${second.name} are very close (${pct(first.score)} and ${pct(second.score)})`;
  }
  let text = `${label}: most like ${first.name} (${pct(first.score)}), then ${second.name} (${pct(second.score)})`;
  if (rest.length === 1) text += `, then ${rest[0].name} (${pct(rest[0].score)})`;
  else if (rest.length > 1) text += `, then ${rest.length} more`;
  return text;
}

export function compareFamily(baby: Person, family: Person[]): Comparison {
  const babyFeatures = featuresById(baby);
  const familyFeatures = family.map((person) => ({ person, features: featuresById(person) }));
  const wins = new Map<string, number>();
  for (const entry of familyFeatures) wins.set(entry.person.id, 0);

  const features: FeatureComparison[] = FEATURES.map((meta) => {
    const babyFeature = babyFeatures.get(meta.id) ?? null;
    const unavailable: { name: string; reason: string }[] = [];
    const ranked: ScoreRow[] = [];
    if (!babyFeature) {
      return {
        id: meta.id,
        label: meta.label,
        sentence: `${meta.label}: not enough photos`,
        ranked,
        unavailable,
        babyMissing: true,
        babyCrop: null,
      };
    }
    for (const entry of familyFeatures) {
      const theirs = entry.features.get(meta.id);
      if (!theirs) {
        unavailable.push({
          name: entry.person.name,
          reason: missingReason(entry.person, meta.needs, meta.label),
        });
        continue;
      }
      const score = featureScore(babyFeature, theirs);
      if (score === null) {
        unavailable.push({ name: entry.person.name, reason: "Not clear enough in the photo" });
        continue;
      }
      ranked.push({
        personId: entry.person.id,
        name: entry.person.name,
        relationship: entry.person.relationship,
        score,
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length >= 2 && ranked[0].score - ranked[1].score >= 0.02) {
      wins.set(ranked[0].personId, (wins.get(ranked[0].personId) ?? 0) + 1);
    } else if (ranked.length === 1) {
      wins.set(ranked[0].personId, (wins.get(ranked[0].personId) ?? 0) + 1);
    }
    const sentence = ranked.length
      ? rankingSentence(meta.label, ranked)
      : `${meta.label}: not enough photos`;
    return {
      id: meta.id,
      label: meta.label,
      sentence,
      ranked,
      unavailable,
      babyMissing: false,
      babyCrop: babyFeature,
    };
  });

  const overall = familyFeatures
    .map(({ person, features: theirs }) => {
      let weighted = 0;
      let weight = 0;
      let compared = 0;
      for (const [id, feature] of theirs) {
        const babyFeature = babyFeatures.get(id);
        if (!babyFeature) continue;
        const score = featureScore(babyFeature, feature);
        if (score === null) continue;
        const w = OVERALL_WEIGHT[id];
        weighted += score * w;
        weight += w;
        compared++;
      }
      return {
        personId: person.id,
        name: person.name,
        relationship: person.relationship,
        score: weight ? weighted / weight : 0,
        wins: wins.get(person.id) ?? 0,
        compared,
      };
    })
    .filter((row) => row.compared > 0)
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  return {
    features,
    overall,
    headline: overallHeadline(baby.name, overall),
    tally: tallyLine(overall),
  };
}

function overallHeadline(babyName: string, overall: OverallRow[]): string {
  if (!overall.length) return `Add family photos to see who ${babyName} resembles.`;
  const byScore = [...overall].sort((a, b) => b.score - a.score || b.wins - a.wins);
  const byWins = [...overall].sort((a, b) => b.wins - a.wins || b.score - a.score);
  const closest = byScore[0];
  const leader = byWins[0];
  const closestPct = Math.round(closest.score * 100);
  if (leader.personId !== closest.personId && leader.wins > closest.wins) {
    return `${babyName} shares the most features with ${leader.name}. ${closest.name} is closest on the photos we could use (${closestPct}%).`;
  }
  const soFar = closest.compared < 4 ? " so far" : "";
  const second = byScore[1];
  if (second && closest.score - second.score < 0.02 && closest.compared > 1) {
    return `${babyName} is nearly tied between ${closest.name} and ${second.name}${soFar}.`;
  }
  return `${babyName} resembles ${closest.name} most overall${soFar} (${closestPct}%).`;
}

function tallyLine(overall: OverallRow[]): string {
  const leaders = overall.filter((row) => row.wins > 0);
  if (!leaders.length) return "No feature has a clear lead yet.";
  return leaders
    .map((row) => `${row.name} leads in ${row.wins} feature${row.wins === 1 ? "" : "s"}`)
    .join(", ") + ".";
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function photoSupports(angle: "front" | "left" | "right", id: FeatureId): boolean {
  const needs = featureMeta(id).needs;
  if (needs === "profile") return angle === "left" || angle === "right";
  return needs === angle;
}
