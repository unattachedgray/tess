/**
 * Federation — discover other Tess instances via BitTorrent DHT.
 *
 * Uses the public BitTorrent DHT network (running since 2005, hundreds of
 * millions of nodes) as a decentralized rendezvous point. Each Tess instance
 * announces itself under a well-known info_hash and discovers other instances.
 *
 * DHT handles only discovery — all game traffic uses HTTP between servers.
 * Set TESS_DISCOVERY=off to completely disable.
 */
import { createHash } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger("federation");

// Well-known info_hash for Tess discovery — all instances use this same hash
const DISCOVERY_TOPIC = "tess-board-game-discovery-v1";
const INFO_HASH = createHash("sha1").update(DISCOVERY_TOPIC).digest("hex");

// Bootstrap nodes — these are well-established public DHT entry points
// that have been running for many years
const BOOTSTRAP_NODES = [
	"router.bittorrent.com:6881",
	"dht.transmissionbt.com:6881",
	"router.utorrent.com:6881",
	"dht.libtorrent.org:25401",
	"dht.aelitis.com:6881",
];

// Re-announce interval (15 minutes)
const ANNOUNCE_INTERVAL = 15 * 60 * 1000;
// Peer verification interval (5 minutes)
const VERIFY_INTERVAL = 5 * 60 * 1000;
// Peer is considered dead after 10 minutes without heartbeat
const PEER_TTL = 10 * 60 * 1000;

export interface FederationPeer {
	host: string;
	port: number;
	url: string;
	name?: string;
	players?: number;
	games?: string[];
	lastSeen: number;
	verified: boolean;
}

export class FederationService {
	private dht: any = null;
	private peers = new Map<string, FederationPeer>();
	private announceTimer: ReturnType<typeof setInterval> | null = null;
	private verifyTimer: ReturnType<typeof setInterval> | null = null;
	private serverPort: number;
	private destroyed = false;

	constructor(private readonly port: number) {
		this.serverPort = port;
	}

	async start(): Promise<void> {
		if (process.env.TESS_DISCOVERY === "off") {
			log.info("federation disabled (TESS_DISCOVERY=off)");
			return;
		}

		try {
			// Dynamic import — bittorrent-dht is ESM
			const DHT = (await import("bittorrent-dht")).default;

			this.dht = new DHT({
				bootstrap: BOOTSTRAP_NODES,
				// Use implied_port so NAT'd instances announce their external port
			});

			this.dht.on("peer", (peer: { host: string; port: number }, _hash: Buffer, _from: any) => {
				this.onPeerDiscovered(peer);
			});

			this.dht.on("ready", () => {
				log.info("DHT ready", { nodeId: this.dht.nodeId?.toString("hex")?.slice(0, 12) });
				this.announce();
			});

			this.dht.on("error", (err: Error) => {
				log.warn("DHT error", { error: err.message });
			});

			this.dht.on("warning", (err: Error) => {
				log.debug("DHT warning", { error: err.message });
			});

			// Listen on a random UDP port for DHT traffic
			this.dht.listen(0, () => {
				const addr = this.dht.address();
				log.info("DHT listening", { port: addr.port });
			});

			// Periodic re-announce
			this.announceTimer = setInterval(() => {
				if (!this.destroyed) this.announce();
			}, ANNOUNCE_INTERVAL);

			// Periodic peer verification via HTTP heartbeat
			this.verifyTimer = setInterval(() => {
				if (!this.destroyed) this.verifyPeers();
			}, VERIFY_INTERVAL);

			log.info("federation started", { topic: DISCOVERY_TOPIC, hash: INFO_HASH.slice(0, 12) });
		} catch (err) {
			log.warn("federation failed to start", { error: (err as Error).message });
		}
	}

	/** Announce our presence on the DHT */
	private announce(): void {
		if (!this.dht || this.destroyed) return;

		// Announce with our HTTP server port so discovered peers can reach our API
		this.dht.announce(INFO_HASH, this.serverPort, (err: Error | null) => {
			if (err) {
				log.debug("announce failed", { error: err.message });
			} else {
				log.debug("announced on DHT", { port: this.serverPort, nodes: this.dht.nodes?.count?.() ?? 0 });
			}
		});

		// Also do a lookup to find new peers
		this.dht.lookup(INFO_HASH, (err: Error | null) => {
			if (err) log.debug("lookup failed", { error: err.message });
		});
	}

	/** Called when DHT discovers a peer */
	private onPeerDiscovered(peer: { host: string; port: number }): void {
		const key = `${peer.host}:${peer.port}`;

		// Skip self-discovery
		if (peer.port === this.serverPort && this.isSelf(peer.host)) return;

		// Skip already known verified peers (just update lastSeen)
		const existing = this.peers.get(key);
		if (existing?.verified) {
			existing.lastSeen = Date.now();
			return;
		}

		log.info("discovered peer", { host: peer.host, port: peer.port });

		// Add as unverified — will be checked by verifyPeers
		this.peers.set(key, {
			host: peer.host,
			port: peer.port,
			url: `http://${peer.host}:${peer.port}`,
			lastSeen: Date.now(),
			verified: false,
		});

		// Immediately attempt verification
		this.verifyPeer(key);
	}

	/** Verify a peer is a real Tess instance via HTTP heartbeat */
	private async verifyPeer(key: string): Promise<void> {
		const peer = this.peers.get(key);
		if (!peer) return;

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
				const data = await res.json() as { name?: string; players?: number; games?: string[] };
				peer.verified = true;
				peer.name = data.name;
				peer.players = data.players;
				peer.games = data.games;
				peer.lastSeen = Date.now();
				log.info("peer verified", { key, name: data.name, players: data.players });
			} else {
				// 403 means federation is disabled on that server — respect it
				this.peers.delete(key);
			}
		} catch {
			// Network error — peer may not be reachable (NAT, firewall)
			// Keep it in the list for a few more attempts
			if (Date.now() - peer.lastSeen > PEER_TTL) {
				this.peers.delete(key);
			}
		}
	}

	/** Periodically verify all peers and remove dead ones */
	private async verifyPeers(): Promise<void> {
		const now = Date.now();
		const toRemove: string[] = [];

		for (const [key, peer] of this.peers) {
			if (now - peer.lastSeen > PEER_TTL) {
				toRemove.push(key);
				continue;
			}
			// Re-verify known peers
			await this.verifyPeer(key);
		}

		for (const key of toRemove) {
			log.debug("removing dead peer", { key });
			this.peers.delete(key);
		}
	}

	private isSelf(host: string): boolean {
		return host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "0.0.0.0";
	}

	/** Get all verified peers */
	getVerifiedPeers(): FederationPeer[] {
		return Array.from(this.peers.values()).filter((p) => p.verified);
	}

	/** Get total player count across all verified peers */
	getRemotePlayerCount(): number {
		let count = 0;
		for (const peer of this.peers.values()) {
			if (peer.verified && peer.players) count += peer.players;
		}
		return count;
	}

	/** Get connection stats */
	getStats(): {
		dhtNodes: number;
		peersDiscovered: number;
		peersVerified: number;
		remotePlayers: number;
	} {
		return {
			dhtNodes: this.dht?.nodes?.count?.() ?? 0,
			peersDiscovered: this.peers.size,
			peersVerified: this.getVerifiedPeers().length,
			remotePlayers: this.getRemotePlayerCount(),
		};
	}

	destroy(): void {
		this.destroyed = true;
		if (this.announceTimer) clearInterval(this.announceTimer);
		if (this.verifyTimer) clearInterval(this.verifyTimer);
		if (this.dht) {
			this.dht.destroy(() => {
				log.info("DHT destroyed");
			});
		}
	}
}
