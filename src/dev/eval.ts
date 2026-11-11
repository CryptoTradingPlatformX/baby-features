import grandpaUrl from "../../test-fixtures/grandpa-front.jpg";
import babyUrl from "../../test-fixtures/baby-front.jpg";
import { analyzePhotoBlob } from "../vision/analyze";
import { appearanceFromCanvas } from "../vision/imageutil";
import { appearanceScore, cosine, geometryScore } from "../analysis/math";
import { decideShares, featureDistances, type DistanceParts } from "../analysis/score";
import type { AnalyzedFeature, FeatureId } from "../types";

const FRONT: FeatureId[] = ["faceShape", "forehead", "eyebrows", "eyes", "nose", "lips", "chin", "cheeks"];

interface Row {
  feature: FeatureId;
  v1Same: number;
  v1Other: number;
  v1Spread: number;
  shapeSame: number | null;
  shapeOther: number | null;
  appearanceSame: number | null;
  appearanceOther: number | null;
  combinedSame: number;
  combinedOther: number;
  shareSame: number;
  shareOther: number;
  v2Spread: number;
  tooClose: boolean;
  driver: string;
}

declare global {
  interface Window {
    __eval?: { rows: Row[]; summary: Record<string, number> };
  }
}

async function loadBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.blob();
}

async function shiftPhoto(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const margin = Math.round(Math.min(bitmap.width, bitmap.height) * 0.08);
  canvas.width = bitmap.width - margin * 2;
  canvas.height = bitmap.height - margin * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.filter = "brightness(1.18) contrast(1.12)";
  ctx.drawImage(bitmap, -margin, -margin);
  ctx.filter = "none";
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!out) throw new Error("could not encode shifted photo");
  return out;
}

function byId(features: AnalyzedFeature[], id: FeatureId): AnalyzedFeature | undefined {
  return features.find((feature) => feature.id === id);
}

async function hogOf(feature: AnalyzedFeature): Promise<number[]> {
  const bitmap = await createImageBitmap(feature.cropBlob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return appearanceFromCanvas(canvas);
}

function v1Score(hogA: number[], hogB: number[], ratiosA: number[], ratiosB: number[]): number {
  const parts: { weight: number; score: number }[] = [];
  if (hogA.length && hogB.length) parts.push({ weight: 0.55, score: appearanceScore(cosine(hogA, hogB)) });
  if (ratiosA.length && ratiosA.length === ratiosB.length) parts.push({ weight: 0.45, score: geometryScore(ratiosA, ratiosB) });
  const weight = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  return parts.reduce((sum, part) => sum + part.weight * part.score, 0) / weight;
}

function num(value: number | null): number {
  return value ?? Number.NaN;
}

async function main() {
  const out = document.querySelector("#out");
  const reference = await analyzePhotoBlob(await loadBlob(grandpaUrl), "front");
  const same = await analyzePhotoBlob(await shiftPhoto(await loadBlob(grandpaUrl)), "front");
  const other = await analyzePhotoBlob(await loadBlob(babyUrl), "front");
  const rows: Row[] = [];
  for (const id of FRONT) {
    const base = byId(reference.analysis.features, id);
    const twin = byId(same.analysis.features, id);
    const stranger = byId(other.analysis.features, id);
    if (!base || !twin || !stranger) continue;
    const [hogBase, hogTwin, hogStranger] = await Promise.all([hogOf(base), hogOf(twin), hogOf(stranger)]);
    const v1Same = v1Score(hogBase, hogTwin, base.geometry, twin.geometry);
    const v1Other = v1Score(hogBase, hogStranger, base.geometry, stranger.geometry);
    const sameParts = featureDistances(id, base, twin) as DistanceParts;
    const otherParts = featureDistances(id, base, stranger) as DistanceParts;
    const decision = decideShares(id, [sameParts, otherParts], [featureDistances(id, twin, stranger)?.combined ?? 1]);
    rows.push({
      feature: id,
      v1Same: round(v1Same),
      v1Other: round(v1Other),
      v1Spread: round(v1Same - v1Other),
      shapeSame: round(num(sameParts.shape)),
      shapeOther: round(num(otherParts.shape)),
      appearanceSame: round(num(sameParts.appearance)),
      appearanceOther: round(num(otherParts.appearance)),
      combinedSame: round(sameParts.combined),
      combinedOther: round(otherParts.combined),
      shareSame: round(decision.shares[0] ?? 0),
      shareOther: round(decision.shares[1] ?? 0),
      v2Spread: round((decision.shares[0] ?? 0) - (decision.shares[1] ?? 0)),
      tooClose: decision.tooClose,
      driver: decision.driver,
    });
  }
  const summary = {
    features: rows.length,
    meanV1Spread: round(avg(rows.map((row) => row.v1Spread))),
    meanV2Spread: round(avg(rows.map((row) => row.v2Spread))),
    minV2Spread: round(Math.min(...rows.map((row) => row.v2Spread))),
    meanShapeRatio: round(avg(rows.map((row) => (row.shapeOther ?? 0) / Math.max(row.shapeSame ?? 0, 1e-4)))),
  };
  window.__eval = { rows, summary };
  if (out) out.textContent = JSON.stringify({ summary, rows }, null, 2);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
}

main().catch((error) => {
  const out = document.querySelector("#out");
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  if (out) out.textContent = message;
  window.__eval = { rows: [], summary: { error: 1 } };
});
