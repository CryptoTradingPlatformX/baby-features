import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], { stdio: "inherit" });
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5173/baby-features/eval.html")).ok) break;
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
  page.on("console", (msg) => console.log("PAGE", msg.type(), msg.text().slice(0, 400)));
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  await page.goto("http://127.0.0.1:5173/baby-features/eval.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction("window.__eval && window.__eval.summary", { timeout: 180000 });
  const result = await page.evaluate(() => window.__eval);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
