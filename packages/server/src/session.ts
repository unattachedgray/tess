import { randomUUID } from "node:crypto";
import type { DifficultyId, GameType } from "@tess/shared";
import type { UciPool } from "./engine/uciPool.js";
import { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";

const log = createLogger("session");

export class SessionManager {
	private rooms = new Map<string, GameRoom>();

	constructor(private readonly uciPool: UciPool) {}

	createRoom(config: {
		gameType: GameType;
		difficulty: DifficultyId;
		playerColor: "white" | "black";
	}): GameRoom {
		const id = randomUUID().slice(0, 8);
		const room = new GameRoom({
			id,
			...config,
			uciPool: this.uciPool,
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
