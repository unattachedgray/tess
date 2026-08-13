# Tess — security posture

Tess is meant to be reachable by anyone, multiplayer included. That is the
design goal, not a compromise of it. So the question this document answers is
not "how do we keep people out" but "what does anonymous access cost us, and
what stops it costing more."

Written after the 2026-08-12 audit, which read every server, shared and client
source file and verified its findings against a live instance.

Companion documents: `~/dev/weft/docs/weft-security.md`, which shares this
machine and one of the mistakes below.

---

## 1. The idea that explains the worst bug

**Schema validity is not authorization.**

Every WebSocket message is parsed through a Zod discriminated union, and unknown
types are rejected. That is genuinely good, and it is why there is no injection
surface worth the name. But a well-formed message from the wrong sender is still
well-formed. `MP_LEAVE` was exactly that: valid, parsed, accepted — and it
destroyed the room without ever asking whether the sender was a player in it.

The consequences were permanent rather than merely annoying. `destroy()` clears
the clock interval *and* sets `running = null`, and `switchSide()` early-returns
when nothing is running, so no subsequent move restarts it. A destroyed game
therefore cannot flag-fall: a losing player simply never times out. The room is
also removed from `mpRooms`, where the reaper and the reconnect scan both look,
so a player who reloads is locked out of their own game permanently. Neither
player was told anything.

Every other multiplayer handler already gated on `getPlayerColor()` returning
non-null. This one gated the resign and the notification, then ran the
destructive part unconditionally.

**The rule:** a handler that mutates shared state must authorize the *sender*
against that state, not merely validate the message.

---

## 2. What is exposed

| surface | reachable by | notes |
|---|---|---|
| `tess.unattached.me` → `:8460` | the internet, via cloudflared | the whole WebSocket protocol and HTTP API |
| `:8460` direct | anything that can route to the host | the server binds all interfaces |

There is no login. A player is identified by a `userId` the server derives from
a client-held secret (sha256 of a `crypto.randomUUID()`, 122 bits), never taken
from the wire — so seats cannot be hijacked by claiming a nickname. That is the
right primitive for a casual public game, and it is deliberately not an account.

### The tunnel changes what an IP means

A reverse tunnel connects *from* loopback. Every visitor arriving through
`tess.unattached.me` therefore presents `socket.remoteAddress` as `127.0.0.1`.

Two consequences, both of which bit real code here:

* **Rate limits keyed on the socket address put the entire internet in one
  bucket.** Three strangers would lock each other out while a genuine flood
  still counted as a single address.
* **A "local only" check based on locality admits everyone.** The federation
  toggle had exactly this shape.

`clientIp()` in `packages/server/src/guard.ts` is the single answer: trust
`cf-connecting-ip` / `x-forwarded-for` **only** when the socket peer is
loopback. A direct caller cannot reach that branch, so it cannot mint itself a
fresh bucket; the only loopback peers are cloudflared and the owner.

---

## 3. Standing invariants

1. **Authorize the sender, not the schema.** See §1.
2. **A refusal must not hand out a reference.** `addPlayer` returns `null` when
   full and `addSpectator` returns `false` past 50. Discarding those returns
   while still assigning `state.mpRoom` is what let a stranger reach into
   someone else's game.
3. **Decide by identity, never by locality** — see §2. Anything that changes the
   network boundary needs a token, and fails closed when the token is unset.
4. **The join code is a bearer credential.** It belongs in `CHALLENGE_CREATED`,
   to its creator, and nowhere else. It is stripped from the broadcast
   `LOBBY_STATE`, and `Challenge.code` is optional in the type so the compiler
   refuses any consumer that assumes otherwise.
5. **One implementation per policy.** `JOIN_BY_CODE` has two seat-granting
   branches. Patching one of them and shipping is a mistake this project has now
   made once; grep for the *condition*, not the function name.
6. **Money is the only truly finite resource.** Sockets and CPU degrade; the
   Gemini bill does not come back.

---

## 4. Limits, and why each number is what it is

Set in `guard.ts`, all env-tunable.

| limit | default | env | reasoning |
|---|---|---|---|
| concurrent sockets, total | 10 | `TESS_MAX_CONNS` | the binding resource is not sockets, it is `ENGINE_POOL_SIZE` (2) and `MAX_CONCURRENT` (2) for AI. Ten players is comfortable against two engine slots; a hundred is not, because every analysis past the pool queues behind a 30-second checkout timeout. |
| sockets per address | 3 | `TESS_MAX_CONNS_PER_IP` | **must stay well below the global cap.** If per-address ≥ global, one caller can occupy every slot and the global cap constrains nobody. Three allows a reload, a second tab, and a phone. |
| messages | 20/s, burst 60 | `TESS_MSG_PER_SEC`, `TESS_MSG_BURST` | real play is a few messages a minute. This composes with the existing per-*connection* limit of 30/s, which is bypassed simply by opening more sockets. |
| frame size | 64 KB | `TESS_MAX_PAYLOAD` | the `ws` default is 100 MB. The largest legitimate message is a settings update. |
| AI calls per address | 120/hour | `TESS_AI_PER_IP_HOUR` | generous for a real player, ruinous for a loop. |
| AI calls, global | 5000/day | `TESS_AI_GLOBAL_DAY` | the one that actually bounds the bill. IPs are cheap, so a distributed flood walks straight past any per-address limit. |

A shared NAT — a school, a café — shares a bucket. That is why the per-address
numbers are generous rather than tight: the aim is to stop one host monopolising
the server, not to police individual players. Anything stricter needs accounts,
and accounts are what a casual public game should not require.

---

## 5. Fixed in the 2026-08-12 pass

* **`MP_LEAVE` authorization** — a non-player is now removed as a spectator and
  the room is left alone. Verified: a stranger's `MP_LEAVE` no longer stops the
  clock, and a real player's still ends the session.
* **`JOIN_BY_CODE` honours refusals** in *both* branches. A full room answers
  "Game is full"; a full gallery answers "Too many spectators".
* **Join codes are no longer broadcast.** `LOBBY_STATE` carries the challenge
  without its code.
* **A spectate-join no longer deletes the creator's challenge.** Watching a game
  that has not started is now refused outright — there was nothing to watch, and
  the old path silently pulled the creator into a room that could never start
  and was never reaped.
* **Connection caps, message caps, frame cap, AI spend caps** — §4.
* **`/api/federation/toggle` requires `TESS_ADMIN_TOKEN`** and fails closed. It
  starts Hyperswarm on the public DHT *and opens a UPnP/NAT-PMP mapping for this
  port on the router*, so an anonymous caller could make the server punch itself
  out to the internet. The old check had two verified bypasses: no
  `X-Forwarded-For` at all fell through to an allowlisted default, and a spoofed
  `X-Forwarded-For: 127.0.0.1` passed outright.
* **`/api/games?limit=` is clamped to 100.** Unclamped it dumped the entire
  games table; `?limit=abc` became `NaN` and returned a 500.
* **`POST /api/users` validates types and lengths.**
* **CORS no longer reflects arbitrary origins with `credentials: true`** — which
  is strictly worse than `*`, because reflection is legal with credentials and
  `*` is not.

---

## 6. Known-open

Ranked. None is a credential compromise; all are documented rather than fixed.

1. **Engine-pool exhaustion.** A pool of 2 with an unbounded queue, and each
   `REQUEST_ANALYSIS` costs 0.3–1.0 s of an engine (two searches in
   multiplayer). The connection cap now bounds the number of callers, but a
   handful of sockets can still make analysis slow for everyone. A
   per-connection in-flight cap of 1 for engine-backed messages is the fix.
2. **The per-client promise chain is unbounded.** `processing = processing.then(...)`
   admits messages faster than handlers drain when they block on the pool.
3. **No `Origin` check on the WebSocket upgrade.** Any page a visitor opens can
   drive the protocol. Impact is limited today because there are no cookies and
   nothing is authorized by ambient identity — but it is what would make any
   future authorization forgeable.
4. **No Content-Security-Policy**, with three `{@html}` sinks in the client. The
   escaping is correct today (escape first, then transform); a CSP is the cheap
   backstop.
5. **The federation move relay would accept a move from any peer** — it never
   checks that the sending peer owns the game. It is dead code: `federatedGames`
   is never written to, and `TESS_DISCOVERY=off`. **Do not wire up the accept
   path without keying each federated game to its peer's public key first.**
6. **Startup kills the pid in `data/.server.pid`.** A stale or reused pid means
   killing an unrelated process. It requires local write access, so it is not a
   remote issue, but it is a real hazard when running a second instance.

---

## 7. Operating this

### Making a change take effect

```bash
cd ~/dev/tess && pnpm build && pm2 startOrReload ecosystem.config.cjs
```

**`startOrReload`, not `restart`.** A plain restart re-runs the process without
re-reading the `env` block in `ecosystem.config.cjs`. Change a limit, restart,
and the server keeps enforcing the old one while the config file says
otherwise — with nothing anywhere to indicate the mismatch.

### Reading the limits actually in force

```bash
curl -s localhost:8460/api/admin | python3 -m json.tool
```

```json
{"uptime": 4, "activeGames": 0, "memory": {"heapMB": 13},
 "guards": {"ips": 0, "connections": 0, "connectionCap": 10,
            "aiToday": 0, "aiDailyCap": 5000}}
```

`connectionCap` and `aiDailyCap` are read out of the running process, so they
are simultaneously the current limits and the proof that the last reload took.
`aiToday` is the day's Gemini spend against its cap. Do not read these numbers
off the source or the config file; those are what you *intended*.

### The token you have not set

`TESS_ADMIN_TOKEN` is deliberately absent from `ecosystem.config.cjs`, so
`/api/federation/toggle` refuses everyone, including you. That is the correct
resting state while `TESS_DISCOVERY=off`. To toggle federation, set the token in
the env block, `pm2 startOrReload`, and pass it as `X-Tess-Admin` — see
`FEDERATION.md`.

The lobby's federation toggle **button** was removed in the same pass. It was a
public control over a network boundary, and since Tess has no login, no browser
can legitimately hold the token — the button could only ever fail silently.

### Two ways to destroy your own server

1. **Never start a second instance from the repo root.** Startup reads
   `data/.server.pid` and `process.kill()`s whatever pid it finds — which is
   your live server. Start test instances from a scratch directory, so the
   pidfile path points somewhere harmless.
2. **`pkill -f` matches its own command line.** `pkill -f "…index.ts"` kills the
   shell running it. Use a bracket to break the self-match:
   `pgrep -f "ts[x] …/index.ts"`.

---

## 8. Re-verification

Each check has a control, because a check that cannot fail proves nothing.

Three harnesses, kept in the repo rather than in a scratch directory, because a
harness that is deleted is a harness you will not re-run.

| what | safe against the live server? |
|---|---|
| `cd packages/server && npx vitest run src/guard.test.ts` | yes — no server needed |
| `node scripts/security/live-caps.mjs` | yes — opens and closes sockets only, creates no games or rows. It does briefly occupy every slot, so do not run it while people are playing. |
| `TESS_ADMIN_TOKEN=… bash scripts/security/http-checks.sh` | yes — read-only apart from one upsert of the user `u-test-harness` |
| `node scripts/security/ws-checks.mjs` | **no** — creates real games. Needs an isolated instance. |

For the last one, start an instance on a spare port **from a scratch
directory**, for the pidfile reason in §7:

```bash
mkdir -p /tmp/tess-test && cd /tmp/tess-test
PORT=8461 TESS_DISCOVERY=off TESS_MAX_CONNS=10 TESS_MAX_CONNS_PER_IP=3 \
  TESS_ADMIN_TOKEN=harness-token npx tsx ~/dev/tess/packages/server/src/index.ts &
cd ~/dev/tess && node scripts/security/ws-checks.mjs
```

Every group carries a control, and they are the point. The harness asserts that
a stranger's `MP_LEAVE` does not end a live game **and** that a real player's
still does; that the join code is absent from the broadcast list **and** that
the creator still receives a usable one; that the eleventh connection is refused
**and** that a freed slot is reusable.

Two earlier security fixes on this machine were tested only against "attack
blocked" and "localhost works", and both broke the owner's real path. A check
that cannot fail proves nothing, and a fix verified without a control is not
verified.

One more thing these harnesses earned: each of the three protocol fixes in §5
was demonstrated **failing** in this same harness against the pre-fix build
before it was demonstrated passing. A test written after the fix, which has
never seen the bug, has not shown that it can detect it.

---

## 9. Where `SECURITY.md` was wrong

`SECURITY.md` claimed *"each client has an isolated session"*. That was the
opposite of true: any client could reach into another pair's room and destroy
it. It also told researchers to reason about Claude CLI output, which has not
existed in this tree since coaching moved to the Gemini API — and said nothing
about the Gemini key or its spend, which is where the actual money risk is.

Both are corrected. When a defence changes, the claim about it changes in the
same commit.
