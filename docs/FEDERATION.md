# Federation & Peer Discovery

How Tess instances discover each other and enable cross-server multiplayer — even behind NAT, without port forwarding.

## How It Works

Every Tess installation automatically joins a global peer discovery network on startup. When two instances find each other, they can share challenges and relay games in real-time over encrypted streams. No manual configuration needed.

```
Player A (Home network, NAT)              Player B (Home network, NAT)
    │                                          │
    └── Tess Server A                          └── Tess Server B
         │                                          │
         ├── Hyperswarm (DHT + UDP hole-punch) ─────┤
         │        Encrypted Noise stream             │
         │                                          │
         ├── UPnP auto port-forward                 ├── UPnP auto port-forward
         │                                          │
         └── mDNS (LAN only) ──── same network ────┘
```

## Three Discovery Layers

All three run concurrently. Each feeds verified peers into the same registry.

### 1. Hyperswarm (Primary — works through NAT)

Uses the **BitTorrent DHT network** (running since 2005, hundreds of millions of nodes) for peer discovery, then establishes **encrypted streams via UDP hole-punching** through NAT. If direct connection fails, traffic relays through DHT bootstrap nodes automatically.

- All Tess instances join a shared discovery topic: `sha256("tess-board-game-discovery-v1")`
- Peers exchange a `tess-hello` handshake with server info
- The resulting stream is encrypted with the **Noise protocol** (same as WireGuard)
- All game traffic (moves, emojis, messages) flows over this stream
- **No open ports needed** — works through most home routers

| NAT Type | Success Rate |
|----------|-------------|
| Home router (typical) | ~95% |
| Symmetric NAT (strict) | ~60% (relay fallback) |
| Corporate firewall | ~40% (may block UDP) |

### 2. UPnP / NAT-PMP (Auto Port Forward)

Automatically opens the server port (default 8082) on the router using **UPnP** or **NAT-PMP** protocols. Works on ~85% of consumer routers without any user intervention.

- Mapping refreshed every 20 minutes
- Makes HTTP federation endpoints reachable from the internet
- Cleaned up automatically on server shutdown
- Falls back gracefully if router doesn't support UPnP

### 3. mDNS / Bonjour (LAN Discovery)

Discovers other Tess instances on the **same local network** via multicast DNS. Zero latency, no internet required.

- Advertises `_tess-game._tcp` service
- Discovered LAN peers verified via HTTP heartbeat
- Ideal for classroom, office, or home scenarios

## Federated Game Protocol

Once two servers are connected via Hyperswarm, they communicate using a JSON-over-stream protocol. All messages are:
- Encrypted (Noise protocol)
- Size-limited (2KB max per message)
- Type-validated before processing
- Parsed in try/catch (invalid messages silently dropped)

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `tess-hello` | Both → Both | Server identification (name, port, games, player count) |
| `tess-challenge` | Creator → All | Broadcast a new challenge to all connected peers |
| `tess-challenge-cancel` | Creator → All | Withdraw a previously broadcast challenge |
| `tess-accept` | Acceptor → Creator | Accept a remote challenge, start the game |
| `tess-move` | Player → Opponent's server | Relay a validated move |
| `tess-emoji` | Player → Opponent's server | Relay an emoji reaction (whitelist-validated) |
| `tess-message` | Player → Opponent's server | Relay a preset message (whitelist-validated) |
| `tess-resign` | Player → Opponent's server | Relay resignation |

### Game Flow

```
1. DISCOVERY
   Server A and Server B find each other via Hyperswarm DHT.
   UDP hole-punching establishes an encrypted stream.

2. HANDSHAKE
   Both servers exchange tess-hello:
   { type: "tess-hello", port: 8082, name: "Tess", games: ["chess","go","janggi"] }

3. CHALLENGE BROADCAST
   Player A creates a challenge in their lobby.
   Server A broadcasts tess-challenge to all connected peers.
   Server B receives it → adds to lobby tagged with "(ServerA)".

4. ACCEPTANCE
   Player B clicks "Play" on the remote challenge.
   Server B sends tess-accept to Server A.
   Both servers create local MultiplayerRoom instances.
   Game relay registered: gameId → peerKey.

5. GAMEPLAY
   Player A moves → Server A validates → relays tess-move to Server B.
   Server B receives → plays move on its local game instance.
   Server B validates independently (both servers are authoritative).

   Emojis and messages relayed the same way:
   tess-emoji and tess-message are whitelist-validated on BOTH sides
   before delivery to the local player.

6. GAME END
   Resignation relayed via tess-resign.
   Both servers run independent post-game evaluation.
   Each player sees their own SKILL_EVAL and game summary.
   Game stats saved locally on each server.
```

## Configuration

### Environment Variables

```bash
# Disable federation entirely (default: on)
TESS_DISCOVERY=off

# Custom server name shown to peers (default: Tess)
TESS_SERVER_NAME=MyTess

# Private discovery group — only instances with the same topic find each other
# Leave unset for public discovery (default)
TESS_DISCOVERY_TOPIC=my-friends-group-2024
```

### Runtime Toggle

The Multiplayer lobby has a "Network Play" toggle that enables/disables federation at runtime without restarting the server. This calls:

```
POST /api/federation/toggle { "enabled": false }
```

Local multiplayer (same server) always works regardless of federation setting.

## Opt-Out

Set `TESS_DISCOVERY=off` in `.env` or toggle off in the Multiplayer lobby. When disabled:

- Server does not join the DHT network
- Server does not advertise via mDNS
- Server does not attempt UPnP port mapping
- All `/api/federation/*` endpoints return `403 Forbidden`
- No network traffic for federation
- Local multiplayer is completely unaffected

## Security

### Encryption

All Hyperswarm traffic is encrypted with the **Noise protocol** (same cryptographic framework as WireGuard and Signal). The encrypted stream is established before any game data is exchanged.

### Input Validation

| Data | Validation |
|------|-----------|
| Swarm buffer | Capped at 4KB, reset on overflow |
| Swarm messages | Max 2KB, JSON-parsed in try/catch |
| Peer name | Max 64 chars, alphanumeric + basic punctuation only |
| Peer port | Must be 1-65535 |
| Player count | Must be 0-9999 |
| Games array | Max 10 entries, strings only |
| HTTP heartbeat response | Max 4KB, all fields validated |
| Emojis | Whitelist: must be in PRESET_EMOJIS (server-side check on both ends) |
| Messages | Whitelist: must be in PRESET_MESSAGES (server-side check on both ends) |
| Moves | Validated by each server's own game instance independently |

### Resource Limits

| Resource | Limit |
|----------|-------|
| Max peers | 50 |
| Peer TTL | 10 minutes without heartbeat |
| Federation peer registration | 10 requests/minute per IP |
| UPnP mapping TTL | 20 minutes (auto-refreshed) |
| DHT re-announce | Every 15 minutes |

### Server-Authoritative

Each server validates its own player's moves using its own game instance. A malicious peer cannot inject illegal moves — the local game engine rejects them. Both servers maintain independent game state.

### No Direct Player Connections

Players never connect to each other directly. All traffic flows:

```
Player A ←WebSocket→ Server A ←Hyperswarm→ Server B ←WebSocket→ Player B
```

### Privacy

- Only server name, game capabilities, and player count are shared with peers
- Game history and player stats are never shared
- The DHT topic is public by default (anyone with the source can discover instances)
- Set `TESS_DISCOVERY_TOPIC` to a shared secret for private discovery groups
- IP addresses are visible to connected peers (inherent to any network connection)

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/federation/status` | Discovery enabled + stats | Public |
| POST | `/api/federation/toggle` | Enable/disable federation | Local only |
| POST | `/api/federation/peers` | Register a peer URL | Rate-limited |
| GET | `/api/federation/peers` | List known peers | Discovery required |
| POST | `/api/federation/heartbeat` | Health check response | Discovery required |
| GET | `/api/federation/challenges` | List challenges for peers | Discovery required |

All endpoints except `/status` and `/toggle` return `403` when discovery is disabled.

## Files

| File | Purpose |
|------|---------|
| `packages/server/src/federation.ts` | Full federation module: Hyperswarm, UPnP, mDNS, game relay |
| `packages/server/src/ws.ts` | Federation callbacks, challenge broadcast, move/emoji relay |
| `packages/server/src/lobby.ts` | Remote challenges injected into lobby broadcast |
| `packages/server/src/http.ts` | Federation REST endpoints, rate limiting |
| `packages/server/src/multiplayerRoom.ts` | Game rooms (local + federated use same class) |
| `.env.example` | Configuration reference |

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `hyperswarm` | DHT discovery + encrypted streams + NAT traversal | ~150KB |
| `bonjour-service` | mDNS/DNS-SD local network discovery | ~50KB |
| `@silentbot1/nat-api` | UPnP/NAT-PMP automatic port forwarding | ~30KB |

## Troubleshooting

### "Searching for other Tess servers..." never finds anyone

- You may be the only Tess instance online. The DHT will find peers within seconds once another instance starts.
- Corporate firewalls may block UDP (used by Hyperswarm). Try a different network.
- Check: `curl http://localhost:8082/api/federation/status` — verify `enabled: true` and `dhtNodes > 0`.

### Remote challenges don't appear

- Peer must be verified (green in stats). Unverified peers haven't completed the `tess-hello` handshake.
- Challenges only broadcast to connected Hyperswarm peers, not HTTP-only peers.

### Game freezes during federated play

- If the Hyperswarm connection drops, moves can't relay. The idle timer (120s for untimed games) will end the game if no moves come through.
- Both servers validate independently — if game state diverges due to a missed message, the game may need to be restarted.

### UPnP shows "not mapped"

- Router may not support UPnP. Check router settings (usually under "Advanced" or "NAT").
- Some ISPs disable UPnP at the network level.
- UPnP is a bonus for HTTP-based federation — Hyperswarm works without it.
