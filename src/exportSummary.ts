import type { Comparison } from "./analysis/compare";
import type { Person } from "./types";

const DISCLAIMER =
  "This compares how photos look. It is not a genetic test. Baby faces change quickly, so retaking pictures every few months is part of the fun.";

export function resultsJson(baby: Person, family: Person[], comparison: Comparison): string {
  return JSON.stringify(
    {
      app: "baby-features",
      version: 1,
      exportedAt: new Date().toISOString(),
      privacy: "Photos were not included. They stayed on the device.",
      disclaimer: DISCLAIMER,
      baby: { name: baby.name },
      family: family.map((person) => ({
        name: person.name,
        relationship: person.relationship,
        photos: {
          front: Boolean(person.photos.front),
          left: Boolean(person.photos.left),
          right: Boolean(person.photos.right),
        },
      })),
      overall: {
        headline: comparison.headline,
        tally: comparison.tally,
        people: comparison.overall.map((row) => ({
          name: row.name,
          relationship: row.relationship,
          score: Math.round(row.score * 100),
          leads: row.wins,
          featuresCompared: row.compared,
        })),
      },
      features: comparison.features.map((feature) => ({
        id: feature.id,
        label: feature.label,
        sentence: feature.sentence,
        tooClose: feature.tooClose,
        decidedBy: feature.driverText,
        ranking: feature.ranked.map((row) => ({
          name: row.name,
          relationship: row.relationship,
          share: row.share == null ? null : Math.round(row.share * 100),
          shapeDistance: row.shapeDistance,
          appearanceDistance: row.appearanceDistance,
          contourDistance: row.contourDistance,
          ratioDistance: row.ratioDistance,
          combinedDistance: row.combinedDistance,
        })),
        notCompared: feature.unavailable,
      })),
    },
    null,
    2,
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function renderSummary(babyName: string, comparison: Comparison): Promise<Blob> {
  await document.fonts.ready.catch(() => undefined);
  const width = 1080;
  const featureLines = comparison.features.map((feature) => feature.sentence);
  const height = 520 + featureLines.length * 72 + 200;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the summary");

  ctx.fillStyle = "#fff6ee";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffe1cc";
  ctx.beginPath();
  ctx.ellipse(540, -40, 520, 220, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c85a45";
  ctx.font = "700 28px Nunito, sans-serif";
  ctx.fillText("BABY FEATURES", 72, 96);
  ctx.fillStyle = "#3f2a22";
  ctx.font = "700 42px Nunito, sans-serif";
  ctx.fillText(babyName, 72, 150);
  ctx.font = "700 54px Fraunces, Georgia, serif";
  wrapText(ctx, comparison.headline, 72, 230, width - 144, 64);

  ctx.font = "600 32px Nunito, sans-serif";
  ctx.fillStyle = "#7d6458";
  const tallyBottom = wrapText(ctx, comparison.tally, 72, 360, width - 144, 42);

  let y = Math.max(430, tallyBottom + 36);
  ctx.font = "700 30px Nunito, sans-serif";
  for (const line of featureLines) {
    ctx.fillStyle = "#fff";
    roundRect(ctx, 56, y, width - 112, 60, 16);
    ctx.fill();
    ctx.fillStyle = "#3f2a22";
    ctx.fillText(trimLine(line, 62), 80, y + 40);
    y += 72;
  }

  y += 24;
  ctx.fillStyle = "#7d6458";
  ctx.font = "400 26px Nunito, sans-serif";
  y = wrapText(ctx, DISCLAIMER, 72, y, width - 144, 36);
  wrapText(ctx, "Photos stayed on this phone. Nothing was uploaded.", 72, y + 12, width - 144, 36);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not save the summary image");
  return blob;
}

function trimLine(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(" ");
  let line = "";
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, cursor);
  return cursor + lineHeight;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
