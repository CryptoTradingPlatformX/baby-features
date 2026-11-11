import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const images = {
  baby: readFileSync("test-fixtures/baby-front.jpg").toString("base64"),
  profile: readFileSync("test-fixtures/baby-profile.jpg").toString("base64"),
  adult: readFileSync("test-fixtures/grandpa-front.jpg").toString("base64"),
};

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  stdio: "ignore",
});

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4173/baby-features/")).ok) break;
    } catch {
      /* starting */
    }
    await delay(200);
  }

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  await page.goto("http://127.0.0.1:4173/baby-features/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=start-baby]", { timeout: 20000 });
  await page.evaluate(async (files) => {
    const binary = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const jpeg = (value) => new Blob([binary(value)], { type: "image/jpeg" });
    const blobs = { baby: jpeg(files.baby), profile: jpeg(files.profile), adult: jpeg(files.adult) };
    const stale = {
      version: 1,
      pose: { kind: "front", widerSide: "left", turned: 0, rollDeg: 0, eyeRatio: 1, widthRatio: 0.8 },
      issues: [],
      features: [
        {
          id: "eyes",
          friendly: "Eyes",
          detail: "",
          confidence: 0.8,
          geometry: [0.3],
          appearance: [1, 0, 0, 0, 0, 0, 0, 0],
          contour: [],
          cropBlob: blobs.baby,
          cropWidth: 8,
          cropHeight: 8,
        },
      ],
      sharpness: 1,
      brightness: 0.5,
    };
    const photo = (angle, blob) => ({ angle, blob, width: 800, height: 1000, createdAt: 1, analysis: stale });
    const people = [
      {
        id: "baby",
        kind: "baby",
        name: "Baby",
        relationship: "Baby",
        createdAt: 1,
        schemaVersion: 1,
        photos: { front: photo("front", blobs.baby), left: photo("left", blobs.profile) },
      },
      {
        id: "mom",
        kind: "family",
        name: "Mom",
        relationship: "Mom",
        createdAt: 2,
        schemaVersion: 1,
        photos: { front: photo("front", blobs.adult), left: photo("left", blobs.profile) },
      },
      {
        id: "dad",
        kind: "family",
        name: "Dad",
        relationship: "Dad",
        createdAt: 3,
        schemaVersion: 1,
        photos: { front: photo("front", blobs.baby), right: photo("right", blobs.profile) },
      },
    ];
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("baby-features", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("people", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("people", "readwrite");
    for (const person of people) tx.objectStore("people").put(person);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, images);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=migration-notice]", { timeout: 20000 });
  console.log("migration started");
  const started = Date.now();
  let sawSix = false;
  let landed = false;
  while (Date.now() - started < 180000) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text.includes("6 of 6")) sawSix = true;
    if (await page.$("[data-testid=results]")) {
      landed = true;
      break;
    }
    await delay(400);
  }
  if (!landed) throw new Error("rebuild never opened the comparison");
  const landedMs = Date.now() - started;
  console.log(sawSix ? "counter reached 6 of 6, then the comparison opened" : "comparison opened");
  const modal = await page.$("[data-testid=migration-notice]");
  if (modal) throw new Error("progress overlay was still up after the comparison opened");
  await page.click("[data-testid=show-math]");
  await page.waitForSelector(".math", { timeout: 5000 });
  const hit = await page.evaluate(() => {
    const button = document.querySelector("[data-testid=results] button[aria-label=Back]");
    if (!button) return "missing back button";
    const rect = button.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top === button || button.contains(top) ? "tappable" : `covered by ${top?.className || top?.tagName}`;
  });
  if (hit !== "tappable") throw new Error(`results controls were not tappable: ${hit}`);
  await page.click("[data-testid=results] button[aria-label=Back]");
  await page.waitForFunction(() => document.body.innerText.includes("Baby Features"), { timeout: 5000 });
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("baby-features");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const people = await new Promise((resolve, reject) => {
      const request = db.transaction("people").objectStore("people").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return people.map((person) => ({
      name: person.name,
      schema: person.schemaVersion,
      photos: Object.entries(person.photos).map(([angle, photo]) => ({
        angle,
        bytes: photo.blob?.size ?? 0,
        version: photo.analysis?.version ?? null,
        shape: photo.analysis?.features?.some((feature) => Array.isArray(feature.shape) && feature.shape.length >= 4) ?? false,
      })),
    }));
  });
  console.log(JSON.stringify({ landedMs, stored }, null, 2));
  const photos = stored.flatMap((person) => person.photos);
  if (stored.length !== 3) throw new Error("people were dropped");
  if (photos.length !== 6) throw new Error("photos were dropped");
  if (photos.some((photo) => photo.bytes < 1000)) throw new Error("original photo bytes were not kept");
  if (!photos.some((photo) => photo.version === 2 && photo.shape)) throw new Error("no photo was reanalyzed");
  await browser.close();
  console.log("migration completion stayed responsive");
} finally {
  server.kill("SIGTERM");
}
