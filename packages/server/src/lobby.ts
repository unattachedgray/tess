import type { Challenge, TimeControl } from "@tess/shared";
import { randomBytes } from "node:crypto";

// Unambiguous characters (no 0/O/1/I/L)
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCode(): string {
	const bytes = randomBytes(6);
	return Array.from(bytes)
		.map((b) => CODE_CHARS[b % CODE_CHARS.length])
		.join("");
}

function generateId(): string {
	return randomBytes(4).toString("hex");
}

export interface LobbyClient {
	userId: string;
	nickname?: string;
	send: (msg: unknown) => void;
}

export interface ChallengeEntry {
	challenge: Challenge;
	creator: LobbyClient;
}

export class Lobby {
	private challenges = new Map<string, ChallengeEntry>();
	private subscribers = new Set<LobbyClient>();
	private cleanupInterval: ReturnType<typeof setInterval>;

	constructor() {
		// Auto-cleanup expired challenges every 5 minutes
		this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
	}

	createChallenge(
		client: LobbyClient,
		gameType: "go" | "chess" | "janggi",
		timeControl: TimeControl,
		color?: "white" | "black",
		boardSize?: number,
	): Challenge {
		const id = generateId();
		const code = generateCode();
		const challenge: Challenge = {
			id,
			code,
			gameType,
			timeControl,
			creatorName: client.nickname || client.userId,
			creatorColor: color,
			boardSize,
			createdAt: Date.now(),
		};
		this.challenges.set(id, { challenge, creator: client });
		this.broadcastState();
		return challenge;
	}

	cancelChallenge(client: LobbyClient, challengeId: string): boolean {
		const entry = this.challenges.get(challengeId);
		if (!entry || entry.creator.userId !== client.userId) return false;
		this.challenges.delete(challengeId);
		this.broadcastState();
		return true;
	}

	getChallenge(challengeId: string): ChallengeEntry | undefined {
		return this.challenges.get(challengeId);
	}

	getByCode(code: string): ChallengeEntry | undefined {
		for (const entry of this.challenges.values()) {
			if (entry.challenge.code === code.toUpperCase()) return entry;
		}
		return undefined;
	}

	removeChallenge(challengeId: string): void {
		this.challenges.delete(challengeId);
		this.broadcastState();
	}

	subscribe(client: LobbyClient): void {
		this.subscribers.add(client);
		console.log(`[lobby] subscriber added: ${client.userId}, total: ${this.subscribers.size}`);
		// Send current state immediately
		client.send({
			type: "LOBBY_STATE",
			challenges: this.getChallengeList(),
			activePlayers: this.subscribers.size,
		});
	}

	unsubscribe(client: LobbyClient): void {
		this.subscribers.delete(client);
	}

	/** Remove all challenges by a specific client (on disconnect). */
	removeClientChallenges(client: LobbyClient): void {
		let changed = false;
		for (const [id, entry] of this.challenges) {
			if (entry.creator.userId === client.userId) {
				this.challenges.delete(id);
				changed = true;
			}
		}
		if (changed) this.broadcastState();
	}

	getChallengeList(): Challenge[] {
		return Array.from(this.challenges.values()).map((e) => e.challenge);
	}

	broadcastState(): void {
		console.log(`[lobby] broadcasting to ${this.subscribers.size} subscribers, ${this.challenges.size} challenges`);
		const msg = {
			type: "LOBBY_STATE" as const,
			challenges: this.getChallengeList(),
			activePlayers: this.subscribers.size,
		};
		for (const sub of this.subscribers) {
			try { sub.send(msg); } catch { /* client gone */ }
		}
	}

	private cleanup(): void {
		const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
		let changed = false;
		for (const [id, entry] of this.challenges) {
			if (entry.challenge.createdAt < thirtyMinAgo) {
				this.challenges.delete(id);
				changed = true;
			}
		}
		if (changed) this.broadcastState();
	}

	destroy(): void {
		clearInterval(this.cleanupInterval);
	}
}
