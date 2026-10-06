# Isolated public runtime

Tess remains public through the existing Cloudflare tunnel. It runs as the
`weft-tess` system account from a root-owned `/opt/weft-tess` release. The only
persistent writable directory is `/var/lib/weft-tess`; the SQLite database lives
there. Engine logs and CUDA caches also stay in that directory or private tmp.
The service cannot read the owner's home. Node and engine binaries are copied
into the release, so no executable needs access to the owner's NVM installation.

`weft-tess.service` binds `127.0.0.1:8460`. Discovery is disabled. A separate
nftables table permits this UID to reach only the local gateway on TCP 8090 and
reply on established connections. Its systemd credential is a separate file
containing the shared public economy gateway key. This is a restricted shared
capability, not an independently revocable Tess credential. There is no primary
owner key, direct Gemini key, paid fallback, or automatic premium escalation.
Both coaching and summaries declare project `tess`, interactive execution,
economy strength, and no escalation. Gateway exhaustion leaves coaching blank;
it does not prevent games. Global request and concurrency limits remain active.

## Deployment

The checked-in service files and `scripts/security/install-isolated.py` describe
the initial migration. The installer expects a staged release at the documented
machine audit directory; it refuses to overwrite an existing `/opt/weft-tess`.
It tests all three engines on an alternate loopback port under the actual
sandbox, checks file/network boundaries with a live gateway positive control,
then refuses cutover if any games are active. It stops only the old Tess PM2
entry and uses SQLite's backup API after that stop. The original database is
retained under `/etc/weft-tess/original-tess.db`. If the final startup fails, it
leaves Tess stopped; it never restarts the old owner-UID public process.

Future updates must stage source, dependencies, client build, engine assets and
Node into a new root-owned release, run the same alternate-port sandbox test,
then stop only `weft-tess.service` and switch releases. Do not deploy by starting
PM2, running source from the owner's home, or copying credentials into source.
Keep the state database outside releases. Before deploying database migrations,
make a consistent SQLite backup. Use `systemctl restart weft-tess` only after the
new release is installed and validated. Never replace the egress table with a
whole-machine firewall reset.

Verification: `pnpm --filter @tess/server test`, server `tsc --noEmit`, and
`scripts/security/smoke.mjs` exercise the frontend, health, and actual engine
suggestions over WebSocket for chess, Janggi, and Go. The smoke test disables
coaching and creates disposable rooms. Gateway tests use a local synthetic
HTTP fixture and verify routing, credential transport, and error redaction.
CUDA requires the listed NVIDIA devices; JIT requires executable writable
memory, so MemoryDenyWriteExecute is deliberately absent. GPU driver access
remains part of the public service's host attack surface.

The bundled KataGo binaries are AppImages. Extract them at release build time
into `assets/engines/katago/katago-cuda-unpacked` and `katago-unpacked`; the
resolver prefers their `AppRun` scripts. This avoids runtime FUSE mounting and
keeps NoNewPrivileges and the device restrictions intact. The engine parser
regression test covers blank startup lines: the previous parser loop could hang
on the AppImage mount error before reporting startup failure.
