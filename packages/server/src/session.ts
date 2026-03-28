import { randomUUID } from "node:crypto";
import type { DifficultyId, GameType } from "@tess/shared";
import type { KataGoAdapter } from "./engine/katago.js";
import type { UciPool } from "./engine/uciPool.js";
import { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";

const log = createLogger("session");

export class SessionManager {
	private rooms = new Map<string, GameRoom>();

	constructor(
		private readonly chessPool: UciPool,
		private readonly janggiPool: UciPool | null,
		private readonly kataGo: KataGoAdapter | null,
	) {}

	createRoom(config: {
		gameType: GameType;
		difficulty: DifficultyId;
		playerColor: "white" | "black";
		boardSize?: number;
	}): GameRoom {
		const id = randomUUID().slice(0, 8);
		// Use Janggi pool if available, otherwise fall back to chess pool
		const uciPool =
			config.gameType === "janggi" && this.janggiPool ? this.janggiPool : this.chessPool;

		const room = new GameRoom({
			id,
			...config,
			uciPool,
			kataGo: this.kataGo,
			useJanggiVariant: config.gameType === "janggi" && !this.janggiPool,
		});

		this.rooms.set(id, room);
		log.info("room created", { id, gameType: config.gameType, difficulty: config.difficulty });
		return room;
	}

	getRoom(id: string): GameRoom | undefined {
		return this.rooms.get(id);
	}

	removeRoom(id: string): void {
		this.rooms.delete(id);
		log.info("room removed", { id });
	}

	get activeRoomCount(): number {
		return this.rooms.size;
	}
}
