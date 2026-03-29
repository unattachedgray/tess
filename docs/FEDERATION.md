# Federation & Peer Discovery

How Tess instances find each other and enable cross-server multiplayer.

## Current Status

**Phase 0** — Stub endpoints exist, opt-out works, no actual federation yet.

Local multiplayer (same server) is fully functional. Cross-network play works manually via IP sharing + game codes. Federation will automate the discovery of other Tess instances.

## Opt-Out

Set `TESS_DISCOVERY=off` in `.env` to completely disable federation:
- All `/api/federation/*` endpoints return 403
- Server does not broadcast presence
- Server does not accept peer registrations
- Local multiplayer is unaffected

## Architecture

```
Tess Instance A                    Tess Instance B
├── Local Lobby                    ├── Local Lobby
├── Federation Module              ├── Federation Module
│   ├── Peer Registry (SQLite)     │   ├── Peer Registry (SQLite)
│   ├── Heartbeat Worker           │   ├── Heartbeat Worker
│   ├── Challenge Broadcaster      │   ├── Challenge Broadcaster
│   └── Peer Discovery             │   └── Peer Discovery
└── Game Rooms                     └── Game Rooms
```

## Discovery Methods

### 1. Manual Peer Registration

User enters a friend's Tess URL in settings. Simplest method, works across the internet.

```
POST /api/federation/peers { "url": "http://friend.example.com:8082" }
```

### 2. LAN Multicast Discovery (mDNS/DNS-SD)

Advertise `_tess._tcp` service on the local network. Auto-discovers Tess instances on the same LAN/WiFi without any configuration.

Only active when `TESS_DISCOVERY` is enabled.

### 3. Gossip Propagation

When Instance A discovers Instance B, A shares its peer list with B. Peers propagate transitively with TTL. Peers that fail heartbeat for 5 minutes are marked dead. Maximum 50 peers per instance.

## Security Model

| Concern | Mitigation |
|---------|-----------|
| **Cheating** | Each server validates its own player's moves (server-authoritative) |
| **Direct player connections** | None — all traffic through the player's Tess server |
| **Malicious peers** | Federation only exchanges JSON metadata. No code execution, no binary data |
| **Data privacy** | Only challenge metadata shared (game type, time control, player name). No game history |
| **Unwanted federation** | `TESS_DISCOVERY=off` completely disables all federation |
| **Peer flooding** | Max 50 peers, heartbeat validation, TTL expiry |

## Protocol

```
1. Discovery
   A finds B via manual URL, mDNS, or gossip

2. Handshake
   A → POST B/api/federation/peers { url: "http://A:8082" }
   B → POST A/api/federation/heartbeat → validates A is a real Tess instance

3. Challenge Sync
   A periodically polls B's GET /api/federation/challenges
   B's challenges appear in A's lobby tagged with server name

4. Game Start
   A's player accepts B's challenge
   A → POST B/api/federation/accept { challengeId, playerInfo }
   Both servers create local game rooms, linked by federation game ID

5. Move Relay
   A → POST B/api/federation/move { gameId, move }
   B validates move against its game state, returns result
   Both servers independently run suggestions + coaching for their player

6. Game End
   Both servers run independent post-game evaluation
   Game stats saved locally on each server
```

## Implementation Phases

| Phase | Feature | Status |
|-------|---------|--------|
| **0** | Stub endpoints + opt-out | Done |
| **1** | Manual peer registration + heartbeat + challenge sharing | Planned |
| **2** | LAN mDNS auto-discovery | Planned |
| **3** | Gossip peer propagation + health monitoring | Planned |
| **4** | Federated game rooms (move relay) | Planned |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/federation/peers` | Register a peer server URL |
| GET | `/api/federation/peers` | List known peer servers |
| POST | `/api/federation/heartbeat` | Respond to peer health check |
| GET | `/api/federation/challenges` | List challenges for federation |

All endpoints return `403` when `TESS_DISCOVERY=off`.

## Files

| File | Purpose |
|------|---------|
| `packages/server/src/http.ts` | Federation endpoints (stub) |
| `packages/server/src/federation.ts` | Federation module (future) |
| `packages/server/src/migrations/001_multiplayer.sql` | Peers table schema |
| `.env.example` | Configuration reference |
