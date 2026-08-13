// Behavioural security checks for the WebSocket protocol.
//
// Run against an ISOLATED instance, never the live server: these create games
// and rooms. See docs/security.md §7 for how to start one safely — in
// particular, start it from a scratch directory, because startup kills
// whatever pid it finds in ./data/.server.pid.
//
//   PORT=8461 TESS_DISCOVERY=off npx tsx packages/server/src/index.ts
//   node scripts/security/ws-checks.mjs
//
// Every group carries a CONTROL: a check that cannot fail proves nothing, and
// two security fixes on this machine broke ordinary use precisely because they
// were only tested against "attack blocked".
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { WebSocket } = require("../../packages/server/node_modules/ws/index.js");

const URL = process.env.TESS_WS ?? "ws://127.0.0.1:8461";
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
	if (cond) { pass++; console.log(`  PASS  ${name}`); }
	else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function open(ip) {
	const headers = ip ? { "CF-Connecting-IP": ip } : {};
	const ws = new WebSocket(URL, { headers });
	ws.msgs = [];
	ws.closedWith = null;
	ws.on("message", (d) => { try { ws.msgs.push(JSON.parse(d.toString())); } catch {} });
	ws.on("close", (c) => { ws.closedWith = c; });
	ws.on("error", () => {});
	return ws;
}
const up = (ws) => new Promise(r => { if (ws.readyState === 1) return r(true);
	ws.on("open", () => r(true)); ws.on("close", () => r(false)); ws.on("error", () => r(false)); });
const send = (ws, m) => ws.send(JSON.stringify(m));
const waitFor = async (ws, type, ms = 3000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		const m = ws.msgs.find(x => x.type === type);
		if (m) return m;
		await sleep(40);
	}
	return null;
};

// ── 1. global cap ────────────────────────────────────────────────────────────
console.log("\nGlobal concurrent cap (TESS_MAX_CONNS=10)");
{
	const socks = [];
	// distinct IPs so the per-IP cap of 3 is not what refuses them
	for (let i = 0; i < 10; i++) { const w = open(`9.9.0.${i}`); socks.push(w); await up(w); }
	await sleep(200);
	const live = socks.filter(w => w.readyState === 1).length;
	ok("10 connections from 10 addresses accepted", live === 10, `live=${live}`);

	const extra = open("9.9.0.99");
	await up(extra); await sleep(400);
	ok("11th connection refused (server full)", extra.readyState !== 1 || extra.closedWith === 1013,
		`state=${extra.readyState} code=${extra.closedWith}`);

	// CONTROL: freeing a slot must let the next one in, or the cap is just a wall
	socks[0].close(); await sleep(400);
	const after = open("9.9.0.98"); const gotIn = await up(after); await sleep(300);
	ok("CONTROL: a freed slot is reusable", gotIn && after.readyState === 1,
		`state=${after.readyState}`);
	after.close();
	for (const w of socks) w.close();
	await sleep(500);
}

// ── 2. per-IP attribution through the tunnel ─────────────────────────────────
console.log("\nPer-IP cap under a tunnel (TESS_MAX_CONNS_PER_IP=3)");
{
	const a = [];
	for (let i = 0; i < 3; i++) { const w = open("203.0.113.7"); a.push(w); await up(w); }
	await sleep(200);
	ok("3 sockets from one forwarded address accepted",
		a.filter(w => w.readyState === 1).length === 3);

	const fourth = open("203.0.113.7"); await up(fourth); await sleep(400);
	ok("4th from the same address refused", fourth.readyState !== 1,
		`state=${fourth.readyState}`);

	// THE point of the fix: a different visitor must NOT share the abuser's bucket
	const other = open("198.51.100.4"); const otherIn = await up(other); await sleep(300);
	ok("a different visitor is unaffected by the abuser", otherIn && other.readyState === 1,
		`state=${other.readyState}`);
	other.close(); for (const w of a) w.close();
	await sleep(500);
}

// ── 3. the join code must not be broadcast ───────────────────────────────────
console.log("\nJoin code confidentiality");
let ALICE_CODE = null, ALICE_ID = null;
{
	const alice = open("203.0.113.10"); await up(alice);
	const eve = open("203.0.113.11"); await up(eve);
	send(alice, { type: "SET_NICKNAME", nickname: "Alice" });
	await sleep(150);
	send(alice, { type: "CREATE_CHALLENGE", gameType: "chess",
		timeControl: { initial: 60, increment: 0 } });
	const created = await waitFor(alice, "CHALLENGE_CREATED");
	ok("creator receives CHALLENGE_CREATED", !!created);
	ALICE_CODE = created?.challenge?.code ?? created?.code ?? null;
	ALICE_ID = created?.challenge?.id ?? created?.challengeId ?? created?.id ?? null;
	ok("CONTROL: the creator still gets a usable code", !!ALICE_CODE && ALICE_CODE.length === 6,
		`code=${ALICE_CODE}`);

	// The connect-time subscribe already pushed an EMPTY LOBBY_STATE. Reading
	// that one made the "code is absent" check pass against an empty list —
	// vacuously. Clear first, then demand a list that actually has the item.
	eve.msgs.length = 0;
	send(eve, { type: "REQUEST_LOBBY" });
	let lob = null;
	for (let i = 0; i < 40 && !lob; i++) {
		lob = eve.msgs.find(m => m.type === "LOBBY_STATE" && (m.challenges ?? []).length > 0) ?? null;
		if (!lob) await sleep(50);
	}
	ok("a stranger receives LOBBY_STATE", !!lob);
	const listed = (lob?.challenges ?? []).find(c => c.id === ALICE_ID);
	ok("CONTROL: the challenge IS visible to the stranger", !!listed,
		`n=${lob?.challenges?.length}`);
	ok("the join code is NOT in the broadcast list", !!listed && listed.code === undefined,
		`code=${JSON.stringify(listed?.code)}`);
	// A3: a spectate-join on an unstarted challenge must not delete it
	const watcher = open("203.0.113.12"); await up(watcher);
	send(watcher, { type: "JOIN_BY_CODE", code: ALICE_CODE, spectate: true });
	await sleep(600);
	ok("spectating an unstarted challenge is refused",
		watcher.msgs.some(m => m.type === "ERROR"),
		`saw ${JSON.stringify(watcher.msgs.map(m=>m.type))}`);

	const eve2 = open("203.0.113.13"); await up(eve2);
	eve2.msgs.length = 0;
	send(eve2, { type: "REQUEST_LOBBY" });
	let lob2 = null;
	for (let i = 0; i < 40 && !lob2; i++) {
		lob2 = eve2.msgs.find(m => m.type === "LOBBY_STATE") ?? null;
		if (!lob2) await sleep(50);
	}
	ok("the challenge survives a stranger's spectate attempt",
		(lob2?.challenges ?? []).some(c => c.id === ALICE_ID),
		`n=${lob2?.challenges?.length}`);

	watcher.close(); eve2.close(); eve.close(); alice.close();
	await sleep(400);
}

// ── 4. MP_LEAVE authorization ────────────────────────────────────────────────
console.log("\nMP_LEAVE cannot be used by a non-player");
{
	const alice = open("203.0.113.20"); await up(alice);
	const bob = open("203.0.113.21"); await up(bob);
	send(alice, { type: "SET_NICKNAME", nickname: "Alice" });
	send(bob, { type: "SET_NICKNAME", nickname: "Bob" });
	await sleep(200);
	send(alice, { type: "CREATE_CHALLENGE", gameType: "chess",
		timeControl: { initial: 60, increment: 0 } });
	const created = await waitFor(alice, "CHALLENGE_CREATED");
	const code = created?.challenge?.code ?? created?.code;
	const id = created?.challenge?.id ?? created?.challengeId ?? created?.id;
	send(bob, { type: "ACCEPT_CHALLENGE", challengeId: id });
	const started = await waitFor(bob, "MP_GAME_START", 4000);
	ok("CONTROL: a real game starts (the owner's path still works)", !!started);

	// Eve tries to take a seat in a full room
	const eve = open("203.0.113.22"); await up(eve);
	eve.msgs.length = 0;
	send(eve, { type: "JOIN_BY_CODE", code });
	await sleep(600);
	const err = eve.msgs.find(m => m.type === "ERROR");
	ok("a full room refuses a third player", !!err, `msgs=${eve.msgs.map(m=>m.type)}`);

	// ...and MP_LEAVE from her must not touch the game
	send(eve, { type: "MP_LEAVE" });
	await sleep(500);
	alice.msgs.length = 0;
	send(alice, { type: "PLAY_MOVE", move: "e2e4" });
	await sleep(800);
	const moved = alice.msgs.some(m => m.type === "MP_MOVE" || m.type === "MOVE" || m.type === "MP_STATE");
	ok("the game survives a stranger's MP_LEAVE", moved,
		`alice saw ${JSON.stringify(alice.msgs.map(m=>m.type))}`);
	ok("neither player was told the session ended",
		!alice.msgs.some(m => m.type === "MP_SESSION_END") &&
		!bob.msgs.some(m => m.type === "MP_SESSION_END"));

	// spectator path: joins, then leaves — game must still be alive
	const watcher = open("203.0.113.23"); await up(watcher);
	send(watcher, { type: "JOIN_BY_CODE", code, spectate: true });
	await sleep(600);
	send(watcher, { type: "MP_LEAVE" });
	await sleep(500);
	bob.msgs.length = 0;
	send(bob, { type: "PLAY_MOVE", move: "e7e5" });
	await sleep(800);
	ok("the game survives a spectator leaving",
		bob.msgs.some(m => m.type === "MP_MOVE" || m.type === "MOVE" || m.type === "MP_STATE"),
		`bob saw ${JSON.stringify(bob.msgs.map(m=>m.type))}`);

	// CONTROL: a real player leaving MUST still end the session
	bob.msgs.length = 0;
	send(alice, { type: "MP_LEAVE" });
	await sleep(700);
	ok("CONTROL: a real player leaving still ends the session",
		bob.msgs.some(m => m.type === "MP_SESSION_END"),
		`bob saw ${JSON.stringify(bob.msgs.map(m=>m.type))}`);

	for (const w of [alice, bob, eve, watcher]) w.close();
	await sleep(300);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
