import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5173/baby-features/")).ok) break;
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
  await page.goto("http://127.0.0.1:5173/baby-features/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=start-baby]");
  await page.click("[data-testid=start-baby]");
  const input = await page.waitForSelector("[data-testid=file-input]");
  await input.uploadFile("/workspace/test-fixtures/baby-front.jpg");
  await page.waitForSelector("[data-testid=use-photo]:not([disabled])", { timeout: 120000 });
  await page.click("[data-testid=use-photo]");
  await delay(500);
  await page.evaluate(async () => {
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
    for (const person of people) {
      person.schemaVersion = 1;
      for (const photo of Object.values(person.photos)) {
        if (!photo?.analysis) continue;
        photo.analysis.version = 1;
        for (const feature of photo.analysis.features) delete feature.shape;
      }
      await new Promise((resolve, reject) => {
        const request = db.transaction("people", "readwrite").objectStore("people").put(person);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Updating saved photos"), { timeout: 15000 });
  console.log("migration started");
  await page.waitForFunction(() => !document.body.innerText.includes("Updating saved photos"), { timeout: 120000 });
  const check = await page.evaluate(async () => {
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
    const person = people[0];
    const photo = person.photos.front;
    return {
      name: person.name,
      schema: person.schemaVersion,
      version: photo.analysis?.version,
      keptBytes: photo.blob?.size ?? 0,
      shape: photo.analysis?.features?.find((feature) => feature.id === "eyes")?.shape?.length ?? 0,
    };
  });
  console.log(JSON.stringify(check));
  if (check.schema !== 2 || check.version !== 2 || check.shape < 4 || check.keptBytes < 1000) {
    throw new Error("migration did not keep the photo and rebuild the analysis");
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
