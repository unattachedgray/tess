/**
 * Federation — discover and connect to other Tess instances.
 *
 * Three discovery layers (all run concurrently):
 *
 * 1. **Hyperswarm** (primary) — DHT-based discovery + UDP hole-punching.
 *    Works through most NATs without port forwarding. Encrypted streams
 *    via Noise protocol. Relay fallback through DHT bootstrap nodes.
 *
 * 2. **UPnP/NAT-PMP** — automatically opens port on the router.
 *    Works on ~85% of home routers. Makes HTTP endpoints reachable.
 *
 * 3. **mDNS (Bonjour)** — instant LAN discovery via multicast.
 *    Zero-latency for same-network peers. No internet needed.
 *
 * All layers feed verified peers into the same peer registry.
 * Set TESS_DISCOVERY=off to disable everything.
 */
import { createHash } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger("federation");

// Discovery topic — customizable via TESS_DISCOVERY_TOPIC env var.
// Default: public topic (all Tess instances find each other).
// Set a custom value to create a private discovery group (e.g., friends-only).
const TOPIC_SEED = process.env.TESS_DISCOVERY_TOPIC ?? "tess-board-game-discovery-v1";
const TOPIC = createHash("sha256").update(TOPIC_SEED).digest();

// Timings
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;  // verify peers every 5 min
const PEER_TTL = 10 * 60 * 1000;           // remove dead peers after 10 min
const UPNP_REFRESH = 20 * 60 * 1000;       // refresh UPnP mapping every 20 min
const MAX_PEERS = 50;                       // prevent memory exhaustion from fake peers

export interface FederationPeer {
	host: string;
	port: number;
	url: string;
	name?: string;
	players?: number;
	games?: string[];
	lastSeen: number;
	verified: boolean;
	source: "hyperswarm" | "mdns" | "http" | "manual";
}

export class FederationService {
	private swarm: any = null;
	private natClient: any = null;
	private bonjour: any = null;
	private bonjourService: any = null;
	private peers = new Map<string, FederationPeer>();
	private swarmConnections = new Map<string, any>(); // peerKey -> socket
	private verifyTimer: ReturnType<typeof setInterval> | null = null;
	private upnpTimer: ReturnType<typeof setInterval> | null = null;
	private upnpMapped = false;
	private destroyed = false;
	private _started = false;

	constructor(private readonly serverPort: number) {}

	async start(): Promise<void> {
		if (this.destroyed || this._started) return;
		if (process.env.TESS_DISCOVERY === "off") {
			log.info("federation disabled (TESS_DISCOVERY=off)");
			return;
		}
		this._started = true;

		// Launch all discovery layers concurrently
		await Promise.allSettled([
			this.startHyperswarm(),
			this.startUpnp(),
			this.startMdns(),
		]);

		// Periodic peer health check
		this.verifyTimer = setInterval(() => this.cleanupPeers(), HEARTBEAT_INTERVAL);

		log.info("federation started", { port: this.serverPort });
	}

	// ── Layer 1: Hyperswarm (primary — works through NAT) ──

	private async startHyperswarm(): Promise<void> {
		try {
			const Hyperswarm = (await import("hyperswarm")).default;
			this.swarm = new Hyperswarm();

			this.swarm.on("connection", (socket: any, info: any) => {
				const key = info.publicKey?.toString("hex")?.slice(0, 16) ?? "unknown";
				log.info("swarm connection", { peer: key });

				// Exchange server info over the encrypted stream
				const ourInfo = JSON.stringify({
					type: "tess-hello",
					port: this.serverPort,
					name: process.env.TESS_SERVER_NAME ?? "Tess",
					games: ["chess", "go", "janggi"],
				});
				socket.write(ourInfo + "\n");

				let buffer = "";
				socket.on("data", (data: Buffer) => {
					buffer += data.toString();
					// Prevent memory exhaustion from peers sending without newlines
					if (buffer.length > 4096) { buffer = ""; return; }
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						this.handleSwarmMessage(line, socket, info);
					}
				});

				socket.on("error", () => {
					this.swarmConnections.delete(key);
				});

				socket.on("close", () => {
					this.swarmConnections.delete(key);
				});

				this.swarmConnections.set(key, socket);
			});

			// Join the discovery topic (both server and client mode)
			const discovery = this.swarm.join(TOPIC, { server: true, client: true });
			await discovery.flushed();

			log.info("hyperswarm ready", {
				topic: TOPIC.toString("hex").slice(0, 16),
			});
		} catch (err) {
			log.warn("hyperswarm failed", { error: (err as Error).message });
		}
	}

	private handleSwarmMessage(raw: string, _socket: any, info: any): void {
		try {
			// Reject oversized messages (prevent memory abuse)
			if (raw.length > 2048) return;

			const msg = JSON.parse(raw);
			if (msg.type !== "tess-hello") return;

			const key = info.publicKey?.toString("hex")?.slice(0, 16) ?? "unknown";
			const host = info.publicKey ? `swarm-${key}` : "unknown";

			// Validate and sanitize fields from untrusted peer
			const port = typeof msg.port === "number" && msg.port > 0 && msg.port < 65536
				? msg.port : 0;
			const name = typeof msg.name === "string"
				? msg.name.slice(0, 64).replace(/[^\w\s\-().]/g, "") : undefined;
			const players = typeof msg.players === "number" && msg.players >= 0 && msg.players < 10000
				? msg.players : undefined;
			const games = Array.isArray(msg.games)
				? msg.games.filter((g: unknown) => typeof g === "string").slice(0, 10) : undefined;

			if (this.peers.size >= MAX_PEERS) return;
			const peerKey = `swarm:${key}`;
			this.peers.set(peerKey, {
				host,
				port,
				url: `swarm://${key}`,
				name,
				players,
				games,
				lastSeen: Date.now(),
				verified: true,
				source: "hyperswarm",
			});

			log.info("swarm peer verified", { name, key });
		} catch {
			// Invalid message — ignore
		}
	}

	// ── Layer 2: UPnP/NAT-PMP (auto port forward) ──

	private async startUpnp(): Promise<void> {
		try {
			const NatAPI = (await import("@silentbot1/nat-api")).default;
			this.natClient = new NatAPI({ enablePMP: true, enableUPNP: true });

			await this.mapPort();

			// Refresh mapping periodically (UPnP mappings expire)
			this.upnpTimer = setInterval(() => this.mapPort(), UPNP_REFRESH);
		} catch (err) {
			log.debug("UPnP/NAT-PMP unavailable", { error: (err as Error).message });
		}
	}

	private async mapPort(): Promise<void> {
		if (!this.natClient || this.destroyed) return;
		try {
			await this.natClient.map({
				publicPort: this.serverPort,
				privatePort: this.serverPort,
				protocol: "TCP",
				description: "Tess Board Game Server",
				ttl: 1200, // 20 minutes
			});
			if (!this.upnpMapped) {
				const ip = await this.natClient.externalIp().catch(() => null);
				log.info("UPnP port mapped", { port: this.serverPort, externalIp: ip });
				this.upnpMapped = true;
			}
		} catch (err) {
			log.debug("UPnP map failed", { error: (err as Error).message });
		}
	}

	// ── Layer 3: mDNS/Bonjour (LAN discovery) ──

	private async startMdns(): Promise<void> {
		try {
			const { Bonjour } = await import("bonjour-service");
			this.bonjour = new Bonjour();

			// Advertise our service on the local network
			this.bonjourService = this.bonjour.publish({
				name: process.env.TESS_SERVER_NAME ?? `Tess-${this.serverPort}`,
				type: "tess-game",
				port: this.serverPort,
				txt: { version: "1.0", games: "chess,go,janggi" },
			});

			// Discover other Tess instances on LAN
			this.bonjour.find({ type: "tess-game" }, (service: any) => {
				if (service.port === this.serverPort) return; // skip self

				const host = service.addresses?.[0] ?? service.host;
				if (!host) return;

				if (this.peers.size >= MAX_PEERS) return; // cap peer count
				const peerKey = `mdns:${host}:${service.port}`;
				log.info("mDNS peer found", { name: service.name, host, port: service.port });

				this.peers.set(peerKey, {
					host,
					port: service.port,
					url: `http://${host}:${service.port}`,
					name: service.name,
					lastSeen: Date.now(),
					verified: false,
					source: "mdns",
				});

				// Verify via HTTP heartbeat
				this.verifyHttpPeer(peerKey);
			});

			log.info("mDNS discovery active");
		} catch (err) {
			log.debug("mDNS unavailable", { error: (err as Error).message });
		}
	}

	// ── HTTP verification (for mDNS and manual peers) ──

	async verifyHttpPeer(key: string): Promise<void> {
		const peer = this.peers.get(key);
		if (!peer || peer.source === "hyperswarm") return; // swarm peers are already verified

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);
			const res = await fetch(`${peer.url}/api/federation/heartbeat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: `http://0.0.0.0:${this.serverPort}` }),
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (res.ok) {
				// Size-limit response to prevent memory abuse from malicious "peers"
				const text = await res.text();
				if (text.length > 4096) { this.peers.delete(key); return; }
				const data = JSON.parse(text) as { name?: string; players?: number; games?: string[] };
				peer.verified = true;
				peer.name = typeof data.name === "string" ? data.name.slice(0, 64) : undefined;
				peer.players = typeof data.players === "number" && data.players < 10000 ? data.players : undefined;
				peer.games = Array.isArray(data.games) ? data.games.slice(0, 10) : undefined;
				peer.lastSeen = Date.now();
				log.info("HTTP peer verified", { key, name: data.name });
			} else {
				this.peers.delete(key);
			}
		} catch {
			if (Date.now() - peer.lastSeen > PEER_TTL) {
				this.peers.delete(key);
			}
		}
	}

	/** Register a manually added peer URL */
	async addManualPeer(url: string): Promise<boolean> {
		const key = `manual:${url}`;
		this.peers.set(key, {
			host: new URL(url).hostname,
			port: parseInt(new URL(url).port || "8082", 10),
			url,
			lastSeen: Date.now(),
			verified: false,
			source: "manual",
		});
		await this.verifyHttpPeer(key);
		return this.peers.get(key)?.verified ?? false;
	}

	// ── Peer management ──

	private cleanupPeers(): void {
		const now = Date.now();
		for (const [key, peer] of this.peers) {
			if (now - peer.lastSeen > PEER_TTL && peer.source !== "hyperswarm") {
				this.peers.delete(key);
			}
		}
		// Re-verify HTTP-based peers
		for (const [key, peer] of this.peers) {
			if (peer.source !== "hyperswarm") {
				this.verifyHttpPeer(key);
			}
		}

		// Broadcast updated player count over swarm connections
		const info = JSON.stringify({
			type: "tess-hello",
			port: this.serverPort,
			name: process.env.TESS_SERVER_NAME ?? "Tess",
			games: ["chess", "go", "janggi"],
		});
		for (const socket of this.swarmConnections.values()) {
			try { socket.write(info + "\n"); } catch {}
		}
	}

	// ── Public API ──

	getVerifiedPeers(): FederationPeer[] {
		return Array.from(this.peers.values()).filter((p) => p.verified);
	}

	getRemotePlayerCount(): number {
		let count = 0;
		for (const peer of this.peers.values()) {
			if (peer.verified && peer.players) count += peer.players;
		}
		return count;
	}

	getStats(): {
		dhtNodes: number;
		peersDiscovered: number;
		peersVerified: number;
		remotePlayers: number;
		swarmConnections: number;
		upnpMapped: boolean;
	} {
		return {
			dhtNodes: this.swarm?.connections?.size ?? 0,
			peersDiscovered: this.peers.size,
			peersVerified: this.getVerifiedPeers().length,
			remotePlayers: this.getRemotePlayerCount(),
			swarmConnections: this.swarmConnections.size,
			upnpMapped: this.upnpMapped,
		};
	}

	destroy(): void {
		this.destroyed = true;
		this._started = false;
		if (this.verifyTimer) clearInterval(this.verifyTimer);
		if (this.upnpTimer) clearInterval(this.upnpTimer);

		// Unmap UPnP port
		if (this.natClient && this.upnpMapped) {
			this.natClient.unmap(this.serverPort).catch(() => {});
		}

		// Stop mDNS
		if (this.bonjourService) {
			try { this.bonjourService.stop?.(); } catch {}
		}
		if (this.bonjour) {
			try { this.bonjour.destroy?.(); } catch {}
		}

		// Close swarm connections
		for (const socket of this.swarmConnections.values()) {
			try { socket.destroy(); } catch {}
		}
		this.swarmConnections.clear();

		// Destroy swarm
		if (this.swarm) {
			this.swarm.destroy().catch(() => {});
		}

		this.peers.clear();
		log.info("federation destroyed");
	}
}
