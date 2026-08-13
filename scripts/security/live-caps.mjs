// Connection-cap checks. SAFE against the live server: these open and close
// sockets only, and create no games or database rows. They do briefly occupy
// every connection slot, so do not run this while people are playing.
//
//   node scripts/security/live-caps.mjs          # defaults to :8460
//
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { WebSocket } = require("../../packages/server/node_modules/ws/index.js");
const WS = process.env.TESS_WS ?? "ws://127.0.0.1:8460";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = ip => { const w = new WebSocket(WS, { headers: { "CF-Connecting-IP": ip } });
  w.on("error", () => {}); return w; };
const up = w => new Promise(r => { w.on("open", () => r(true)); w.on("close", () => r(false)); w.on("error", () => r(false)); });

const socks = [];
for (let i = 0; i < 10; i++) { const w = open(`9.9.1.${i}`); socks.push(w); await up(w); }
await sleep(200);
console.log(`  10 distinct visitors accepted:      ${socks.filter(w=>w.readyState===1).length === 10 ? "PASS" : "FAIL"}`);
const extra = open("9.9.1.99"); await up(extra); await sleep(400);
console.log(`  11th refused (global cap holds):    ${extra.readyState !== 1 ? "PASS" : "FAIL"}`);
socks[0].close(); await sleep(400);
const back = open("9.9.1.98"); const ok = await up(back); await sleep(200);
console.log(`  CONTROL: freed slot is reusable:    ${ok && back.readyState===1 ? "PASS" : "FAIL"}`);
// per-IP: one address may not exceed 3
for (const w of socks) w.close(); back.close(); await sleep(600);
const a = []; for (let i=0;i<3;i++){ const w=open("203.0.113.77"); a.push(w); await up(w); }
await sleep(200);
const fourth = open("203.0.113.77"); await up(fourth); await sleep(400);
console.log(`  4th from one address refused:       ${fourth.readyState !== 1 ? "PASS" : "FAIL"}`);
const other = open("198.51.100.88"); const oin = await up(other); await sleep(200);
console.log(`  CONTROL: a different visitor is ok: ${oin && other.readyState===1 ? "PASS" : "FAIL"}`);
for (const w of [...a, other, fourth]) w.close();
await sleep(400);
