# Deployment Guide

This guide covers deploying Tess in production on a Linux server.

## Requirements

- **OS**: Linux (Ubuntu 22.04+ recommended) or WSL2
- **Node.js**: 20+
- **pnpm**: 8+ (auto-installed by `tess.sh`)
- **PM2**: For process management (`npm install -g pm2`)
- **Engine binaries**: See [ENGINES.md](ENGINES.md)
- **Claude Code CLI**: Optional, for AI coaching features

### Hardware

- **CPU**: 2+ cores (engines are CPU-intensive)
- **RAM**: 2 GB minimum, 4 GB recommended (KataGo with CUDA needs more)
- **Disk**: 500 MB for the application, 1-2 GB for engine binaries and models
- **GPU**: Optional. NVIDIA GPU with CUDA for faster KataGo analysis

## Quick Deploy

```bash
git clone <repo-url>
cd tess
./tess.sh install    # Install deps, check engines, build
./tess.sh prod       # Start production server on port 8082
```

## Step-by-Step Setup

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Install pnpm and PM2

```bash
npm install -g pnpm pm2
```

### 3. Clone and Install

```bash
git clone <repo-url> /opt/tess
cd /opt/tess
pnpm install
pnpm run build
```

### 4. Place Engine Binaries

See [ENGINES.md](ENGINES.md) for download links and setup instructions. Place binaries in `assets/engines/`.

### 5. Environment Configuration

Set environment variables or export them in your shell:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8082` | HTTP/WS server port |
| `NODE_ENV` | — | Set to `production` for production mode |
| `ENGINE_POOL_SIZE` | `2` | UCI engine processes. **This, not RAM, is what limits how many people can analyse at once.** |
| `TESS_DISCOVERY` | on | Set to `off` to disable federation entirely |
| `TESS_ADMIN_TOKEN` | — | Required by `POST /api/federation/toggle`, sent as `X-Tess-Admin`. **Unset means the route is refused for everyone**, including you — that is deliberate, because the route opens a UPnP mapping on your router. |
| `TESS_ALLOWED_ORIGINS` | `https://tess.unattached.me` | Comma-separated CORS allowlist. Only matters for a separately-hosted client; the bundled one is same-origin. |

**Abuse guards** for a public bind. Full reasoning for each number is in
[`security.md`](security.md) §4; the short version is here.

| Variable | Default | Description |
|----------|---------|-------------|
| `TESS_MAX_CONNS` | `10` | Total concurrent sockets. Sized against `ENGINE_POOL_SIZE`, not against memory. |
| `TESS_MAX_CONNS_PER_IP` | `3` | Sockets one address may hold. **Must stay well below `TESS_MAX_CONNS`** — if it does not, one caller can take every slot and the total cap constrains nobody. |
| `TESS_MSG_PER_SEC` / `TESS_MSG_BURST` | `20` / `60` | Client message budget per address. |
| `TESS_MAX_PAYLOAD` | `65536` | Largest client frame. The `ws` library default is 100 MB. |
| `TESS_AI_PER_IP_HOUR` | `120` | Gemini coaching calls per address per hour. |
| `TESS_AI_GLOBAL_DAY` | `5000` | Gemini calls per day, all callers. **This is the one that bounds the bill** — addresses are cheap, so a distributed flood walks past any per-address limit. |

Example:

```bash
export PORT=8082
export NODE_ENV=production
```

### 6. Start with PM2

Tess includes a PM2 ecosystem config:

```bash
pm2 start ecosystem.config.cjs
```

**Redeploying after a code or config change:**

```bash
pnpm build && pm2 startOrReload ecosystem.config.cjs
```

> **`startOrReload`, not `restart`.** A plain `pm2 restart` re-runs the process
> but does **not** re-read the `env` block in `ecosystem.config.cjs`. Change a
> limit, restart, and the server keeps running the old value while the config
> file says otherwise — with nothing to indicate the mismatch. Verify with
> `curl localhost:8460/api/admin`, which reports the caps actually in force.

The build prints Svelte accessibility warnings (`a11y_*`) for the menu dialog
and a settings button. They are pre-existing, unrelated to deployment, and do
not fail the build.

The config (`ecosystem.config.cjs`):

```javascript
module.exports = {
  apps: [
    {
      name: "tess",
      cwd: "./packages/server",
      script: "npx",
      args: "tsx src/index.ts",
      env: {
        NODE_ENV: "production",
        PORT: "8082",
      },
      autorestart: true,
      max_restarts: 5,
    },
  ],
};
```

### 7. PM2 Startup (Auto-restart on Reboot)

```bash
pm2 startup
pm2 save
```

### 8. PM2 Management

```bash
pm2 status           # Check process status
pm2 logs tess        # View logs
pm2 restart tess     # Restart
pm2 stop tess        # Stop
pm2 monit            # Real-time monitoring
```

## Reverse Proxy (nginx)

Tess runs on a single port serving both HTTP (REST + static files) and WebSocket. Configure nginx to proxy both.

### Install nginx

```bash
sudo apt install -y nginx
```

### Configuration

Create `/etc/nginx/sites-available/tess`:

```nginx
upstream tess_backend {
    server 127.0.0.1:8082;
}

server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS (uncomment when SSL is configured)
    # return 301 https://$host$request_uri;

    location / {
        proxy_pass http://tess_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /game-ws {
        proxy_pass http://tess_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/tess /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot will automatically modify the nginx config for HTTPS.

## Monitoring

### Health Check

```bash
curl http://localhost:8082/api/health
```

Returns server status, uptime, active game count, and memory usage.

### Detailed Stats

```bash
curl http://localhost:8082/api/admin
```

Returns uptime, active game count, heap usage, and — under `guards` — the abuse
limits **actually in force on the running process**:

```json
{"uptime": 4, "activeGames": 0, "memory": {"heapMB": 13},
 "guards": {"ips": 0, "connections": 0, "connectionCap": 10,
            "aiToday": 0, "aiDailyCap": 5000}}
```

Read `connectionCap` and `aiDailyCap` here rather than from the source or the
config file. They are the ones the process is enforcing, so they are also the
proof that your last `startOrReload` actually took. `aiToday` is the day's
Gemini spend against `aiDailyCap`.

Note: PID and Node version are deliberately **not** exposed, despite what
`API.md` says.

### PM2 Monitoring

```bash
pm2 monit            # Live dashboard
pm2 logs tess        # Tail logs
pm2 logs tess --lines 100   # Last 100 lines
```

### Health Check Script

Example cron job to restart if unhealthy:

```bash
#!/bin/bash
# /opt/tess/healthcheck.sh
if ! curl -sf http://localhost:8082/api/health > /dev/null 2>&1; then
    pm2 restart tess
    echo "$(date) - Tess restarted" >> /var/log/tess-healthcheck.log
fi
```

```bash
# Run every 5 minutes
crontab -e
*/5 * * * * /opt/tess/healthcheck.sh
```

## Backup

### Database

The SQLite database is stored at `data/tess.db`. Back it up while the server is running (WAL mode supports concurrent reads):

```bash
sqlite3 /opt/tess/data/tess.db ".backup '/opt/backups/tess-$(date +%Y%m%d).db'"
```

Or simply copy the file (safe with WAL mode):

```bash
cp /opt/tess/data/tess.db /opt/backups/tess-$(date +%Y%m%d).db
```

### Automated Backup

```bash
# Daily backup via cron
0 3 * * * sqlite3 /opt/tess/data/tess.db ".backup '/opt/backups/tess-$(date +\%Y\%m\%d).db'" && find /opt/backups -name "tess-*.db" -mtime +30 -delete
```

This backs up daily at 3 AM and removes backups older than 30 days.

## Updating

```bash
cd /opt/tess
git pull
pnpm install
pnpm run build
pm2 restart tess
```

PM2 handles zero-downtime restarts. Active WebSocket connections will be dropped, but the client auto-reconnects.

## Troubleshooting

### Server won't start

```bash
pm2 logs tess --lines 50    # Check logs
./tess.sh status             # Check engine availability
```

### Engines not found

Verify binaries are in `assets/engines/` and have execute permissions:

```bash
ls -la assets/engines/
chmod +x assets/engines/fairy-stockfish
chmod +x assets/engines/katago/katago
```

### WebSocket connection fails

Ensure nginx is proxying WebSocket upgrades. Check that the `/game-ws` location block includes the `Upgrade` and `Connection` headers.

### High memory usage

KataGo with a large model can use significant memory. Monitor with:

```bash
pm2 monit
curl http://localhost:8082/api/admin
```

### Database locked

SQLite WAL mode should prevent this. If it occurs, check for stale lock files:

```bash
ls -la data/tess.db*
# Remove -wal and -shm files only if the server is stopped
```
