import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const out = "/tmp/baby-shots";
mkdirSync(out, { recursive: true });
const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { stdio: "inherit" });

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
  await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 2 });
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  await page.goto("http://127.0.0.1:5173/baby-features/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=start-baby]");
  await page.click("[data-testid=start-baby]");
  await upload(page, "/workspace/test-fixtures/grandpa-front.jpg");
  await clickText(page, "Done");
  await page.waitForSelector("[data-testid=feature-list]");
  await clickText(page, "Add family");
  await addPreset(page, "Mom", "/tmp/grandpa-shift.jpg");
  await page.waitForSelector("[data-testid=add-family]");
  await addPreset(page, "Dad", "/workspace/test-fixtures/baby-front.jpg");
  await page.waitForSelector("[data-testid=compare]");
  await page.click("[data-testid=compare]");
  await page.waitForSelector("[data-testid=results]");
  await page.click("[data-testid=show-math]");
  await delay(300);
  console.log("SUMMARY", await page.$eval(".summary-card", (el) => el.innerText));
  console.log("EYES", await page.$eval("[data-testid=result-eyes]", (el) => el.innerText));
  await page.screenshot({ path: `${out}/results-math-top.png` });
  await page.$eval("[data-testid=math-eyes]", (el) => el.scrollIntoView({ block: "center" }));
  await delay(200);
  await page.screenshot({ path: `${out}/results-math-eyes.png` });
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

async function addPreset(page, preset, file) {
  await page.click("[data-testid=add-family]");
  await page.waitForSelector("form.form");
  await clickText(page, preset);
  await page.click("form.form button.btn:not(.secondary)");
  await page.waitForSelector("[data-testid=step-front]");
  await upload(page, file);
  await clickText(page, "Done");
}

async function upload(page, file) {
  const input = await page.waitForSelector("[data-testid=file-input]");
  await input.uploadFile(file);
  await page.waitForSelector("[data-testid=review]", { timeout: 120000 });
  const info = await page.$eval("[data-testid=review]", (el) => el.getAttribute("data-features"));
  console.log("uploaded", file, info);
  const button = await page.waitForSelector("[data-testid=use-photo]:not([disabled])");
  await button.click();
  await delay(300);
}

async function clickText(page, text) {
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label);
    if (!button) throw new Error(`No button ${label}`);
    button.click();
  }, text);
}
