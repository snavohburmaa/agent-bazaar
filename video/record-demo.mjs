// Records a real AgentBazaar session in a headless browser and saves it as MP4.
// Usage: node record-demo.mjs [http://localhost:3000]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.resolve("out");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake cursor so viewers can follow the clicks.
const CURSOR = `
(() => { const c = document.createElement('div'); c.id='__cur'; Object.assign(c.style,{position:'fixed',left:'0px',top:'0px',width:'22px',height:'22px',borderRadius:'50%',
 background:'rgba(92,200,173,.35)',border:'2px solid #5cc8ad',zIndex:999999,pointerEvents:'none',transition:'left .35s ease, top .35s ease, transform .15s'}); document.body.appendChild(c);
 window.__moveCursor=(x,y)=>{c.style.left=(x-11)+'px';c.style.top=(y-11)+'px'}; window.__clickCursor=()=>{c.style.transform='scale(.6)';setTimeout(()=>c.style.transform='scale(1)',150)}; })();`;

async function moveAndClick(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no element ${selector}`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => window.__moveCursor(x, y), [x, y]);
  await sleep(500);
  await page.evaluate(() => window.__clickCursor());
  await page.locator(selector).first().click();
  await sleep(300);
}
async function typeSlowly(page, selector, text) {
  const el = page.locator(selector).first();
  await moveAndClick(page, selector);
  await el.fill("");
  for (const ch of text) { await el.type(ch, { delay: 0 }); await sleep(28); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } }, colorScheme: "dark", acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.addInitScript(CURSOR);
await page.evaluate(CURSOR);
await sleep(2500);

// 1. Question
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await typeSlowly(page, "#q", "Should I build a game on Avalanche right now?");
await sleep(600);
await page.evaluate(() => document.querySelector("#lb").scrollIntoView({ behavior: "smooth", block: "center" }));
await sleep(2200);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(900);
await moveAndClick(page, "#go");
await page.waitForSelector("#ap", { timeout: 90_000 });

// 2. Plan
await sleep(3500);
await moveAndClick(page, "#ap");

// 3. Live economy: wait for report_ready (page navigates to report automatically)
await page.waitForSelector("#dl", { timeout: 240_000 });

// 4. Report
await sleep(2500);
await page.evaluate(() => window.scrollBy({ top: 500, behavior: "smooth" }));
await sleep(2500);
await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" }));
await sleep(2500);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(1200);
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), moveAndClick(page, "#dl")]);
await dl.saveAs(path.join(OUT, "demo-report.pdf"));
await sleep(2500);

await page.evaluate(() => document.querySelector("#lb")?.scrollIntoView({ behavior: "smooth", block: "center" }));
await sleep(2500);

const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
const mp4 = path.join(OUT, "agentbazaar-demo.mp4");
execFileSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "ignore" });
fs.unlinkSync(webm);
console.log("saved", mp4);
