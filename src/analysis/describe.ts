import type { FeatureId } from "../types";

export function describeFeature(id: FeatureId, geometry: number[]): { friendly: string; detail: string } {
  switch (id) {
    case "faceShape":
      return describeFace(geometry);
    case "forehead":
      return describeForehead(geometry);
    case "eyebrows":
      return describeBrows(geometry);
    case "eyes":
      return describeEyes(geometry);
    case "nose":
      return describeNose(geometry);
    case "lips":
      return describeLips(geometry);
    case "chin":
      return describeChin(geometry);
    case "cheeks":
      return describeCheeks(geometry);
    case "leftEar":
    case "rightEar":
      return describeEar(geometry);
    case "noseProfile":
      return {
        friendly: "Nose from the side",
        detail: "Compared by the bridge curve and how far the tip projects, scaled to the face.",
      };
    case "chinProfile":
      return {
        friendly: "Chin from the side",
        detail: "Compared by the side silhouette under the lip, not by absolute size.",
      };
    default:
      return { friendly: "Feature captured", detail: "" };
  }
}

function describeFace(g: number[]): { friendly: string; detail: string } {
  const ratio = g[0] ?? 0.75;
  const jaw = g[1] ?? 0.8;
  const shape = ratio > 0.88 ? "Round" : ratio > 0.78 ? "Soft oval" : ratio > 0.68 ? "Oval" : "Longer";
  const jawWord = jaw > 0.92 ? "broader jaw" : "softer jaw";
  return {
    friendly: `${shape} face`,
    detail: `Width compared with length, and a ${jawWord}. Babies are often rounder than the adults they resemble.`,
  };
}

function describeForehead(g: number[]): { friendly: string; detail: string } {
  const height = g[0] ?? 0.3;
  const word = height > 0.34 ? "Taller upper face" : height < 0.24 ? "Shorter upper face" : "Balanced upper face";
  return {
    friendly: word,
    detail: "The area above the eyebrows. Hats and bangs make this less reliable.",
  };
}

function describeBrows(g: number[]): { friendly: string; detail: string } {
  const arch = g[0] ?? 0;
  const word = arch > 0.18 ? "Arched eyebrows" : arch < 0.08 ? "Straighter eyebrows" : "Gently curved eyebrows";
  return { friendly: word, detail: "Arch and spacing, scaled to the brow itself." };
}

function describeEyes(g: number[]): { friendly: string; detail: string } {
  const aspect = g[0] ?? 0.32;
  const tilt = g[1] ?? 0;
  const shape = aspect > 0.42 ? "Round" : aspect > 0.28 ? "Almond" : "Narrow";
  const tiltWord = tilt > 6 ? "upturned" : tilt < -6 ? "downturned" : "level";
  return {
    friendly: `${shape}, ${tiltWord} eyes`,
    detail: "Eye-opening shape and tilt. A baby's eyes look large next to an adult's, so size is down-weighted.",
  };
}

function describeNose(g: number[]): { friendly: string; detail: string } {
  const width = g[0] ?? 0.25;
  const word = width > 0.32 ? "Broader nose" : width < 0.22 ? "Narrower nose" : "Medium nose";
  return { friendly: word, detail: "Front view: width and length as fractions of the face." };
}

function describeLips(g: number[]): { friendly: string; detail: string } {
  const fullness = g[1] ?? 0.35;
  const word = fullness > 0.48 ? "Fuller lips" : fullness < 0.28 ? "Thinner lips" : "Medium lips";
  return { friendly: word, detail: "Shape of the mouth with the lips relaxed. A big smile changes this." };
}

function describeChin(g: number[]): { friendly: string; detail: string } {
  const taper = g[1] ?? 0.7;
  const word = taper < 0.62 ? "Narrower chin" : taper > 0.82 ? "Broader chin" : "Medium chin";
  return { friendly: word, detail: "Jaw width and how the chin tapers, from the front." };
}

function describeCheeks(g: number[]): { friendly: string; detail: string } {
  const bulge = g[0] ?? 0.05;
  const word = bulge > 0.08 ? "Fuller cheeks" : bulge < 0.035 ? "Flatter cheeks" : "Soft cheeks";
  return {
    friendly: word,
    detail: "How far the cheeks curve out from the jaw line. Baby cheeks are often fuller.",
  };
}

function describeEar(g: number[]): { friendly: string; detail: string } {
  const aspect = g[0] ?? 1.5;
  const word = aspect > 1.75 ? "Longer ear outline" : aspect < 1.25 ? "Rounder ear outline" : "Balanced ear outline";
  return {
    friendly: word,
    detail: "Side-photo outline and inner ridges, scaled so a small ear can match a larger one.",
  };
}
