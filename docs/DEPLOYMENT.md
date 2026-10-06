# Deployment

Production uses a dedicated system account and root-owned release. The old PM2
and owner-home deployment path is retired. See [isolated runtime](isolated-runtime.md)
for the installed paths, initial migration script, credential scope, backups,
network policy, update sequence, and verification requirements.

## Local development

Install dependencies with `pnpm install`, fetch the documented engines, and run
`pnpm dev`. The server binds loopback by default. Games work without AI credentials;
coaching requires a separately provisioned economy gateway file credential. Do not
copy the owner's provider keys or source a home environment file into the server.

## Production service

The source definitions are `scripts/security/weft-tess.service` and
`weft-tess-egress.service`. Service state is separate from source and releases.
The Cloudflare tunnel targets `127.0.0.1:8460`; there is no public host listener.

Operational inspection uses `systemctl status weft-tess` and
`journalctl -u weft-tess`. Only the installed system service should be restarted;
`ecosystem.config.cjs` intentionally contains no applications. Never run
`pm2 restart all` to deploy Tess.

A new release must preserve the pinned dependency layout, root ownership,
contained symlinks, built client assets, standalone Node runtime and extracted
KataGo AppImages. Validate the service with `systemd-analyze verify`, then prove
all three engines under the actual sandbox on an alternate loopback port with a
disposable database. Refuse cutover while games are active. Stop the service,
create a consistent SQLite backup, install the release, start the service, and
run local and public smoke tests. Keep the prior root-owned release and database
backup for rollback. Never restore an owner-account public process as rollback.

## Verification

- `pnpm --filter @tess/server test`
- `pnpm --filter @tess/server exec tsc --noEmit`
- `node scripts/security/smoke.mjs http://127.0.0.1:8460`
- `node scripts/security/smoke.mjs https://tess.unattached.me`

The smoke test checks frontend and health and asks each real engine for a move
suggestion in a disposable room. Coaching is disabled, so it does not consume AI
quota. Read effective abuse limits from `/api/admin`; configuration files alone
do not prove which settings a process is enforcing. Separately verify the running
UID, NoNewPrivileges, empty capabilities, sandbox properties and loopback listener.
