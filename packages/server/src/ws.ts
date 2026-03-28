import type { ServerType } from "@hono/node-server";
import { ClientMessage } from "@tess/shared";
import { type WebSocket, WebSocketServer } from "ws";
import type { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";
import type { SessionManager } from "./session.js";

const log = createLogger("ws");

interface ClientState {
	ws: WebSocket;
	room: GameRoom | null;
}

export function createWsServer(
	server: ServerType,
	sessionManager: SessionManager,
): WebSocketServer {
	// biome-ignore lint: ServerType is compatible at runtime
	const wss = new WebSocketServer({ server: server as any });
	const clients = new Map<WebSocket, ClientState>();

	// Heartbeat
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if ((ws as unknown as { isAlive: boolean }).isAlive === false) {
				ws.terminate();
				continue;
			}
			(ws as unknown as { isAlive: boolean }).isAlive = false;
			ws.ping();
		}
	}, 30000);

	wss.on("close", () => clearInterval(heartbeat));

	wss.on("connection", (ws: WebSocket) => {
		(ws as unknown as { isAlive: boolean }).isAlive = true;
		ws.on("pong", () => {
			(ws as unknown as { isAlive: boolean }).isAlive = true;
		});

		const state: ClientState = { ws, room: null };
		clients.set(ws, state);
		log.info("client connected", { clients: clients.size });

		let processing = Promise.resolve();

		ws.on("message", (data: Buffer) => {
			processing = processing
				.then(() => handleMessage(state, data.toString()))
				.catch((err) => {
					log.error("message handling error", { error: (err as Error).message });
				});
		});

		ws.on("close", () => {
			const clientState = clients.get(ws);
			if (clientState?.room) {
				sessionManager.removeRoom(clientState.room.id);
			}
			clients.delete(ws);
			log.info("client disconnected", { clients: clients.size });
		});

		ws.on("error", (err) => {
			log.error("ws error", { error: err.message });
		});
	});

	function send(ws: WebSocket, data: unknown): void {
		if (ws.readyState === ws.OPEN) {
			ws.send(JSON.stringify(data));
		}
	}

	async function handleMessage(state: ClientState, raw: string): Promise<void> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			send(state.ws, { type: "ERROR", message: "Invalid JSON" });
			return;
		}

		const result = ClientMessage.safeParse(parsed);
		if (!result.success) {
			send(state.ws, { type: "ERROR", message: `Invalid message: ${result.error.message}` });
			return;
		}

		const msg = result.data;

		switch (msg.type) {
			case "NEW_GAME": {
				if (state.room) {
					sessionManager.removeRoom(state.room.id);
				}

				const room = sessionManager.createRoom({
					gameType: msg.gameType,
					difficulty: msg.difficulty,
					playerColor: msg.playerColor,
				});

				state.room = room;

				room.onMove((data) => send(state.ws, data));
				send(state.ws, room.getState());

				try {
					await room.startIfAiFirst();
				} catch (err) {
					log.error("failed to start game", { error: (err as Error).message });
					sessionManager.removeRoom(room.id);
					state.room = null;
					send(state.ws, { type: "ERROR", message: "Failed to start game" });
				}
				break;
			}

			case "PLAY_MOVE": {
				if (!state.room) {
					send(state.ws, { type: "ERROR", message: "No active game" });
					return;
				}
				const moveResult = await state.room.playMove(msg.move);
				if (!moveResult.success) {
					send(state.ws, { type: "ERROR", message: moveResult.error });
				}
				break;
			}

			case "RESIGN": {
				if (!state.room) {
					send(state.ws, { type: "ERROR", message: "No active game" });
					return;
				}
				send(state.ws, state.room.resign(state.room.playerColor));
				sessionManager.removeRoom(state.room.id);
				state.room = null;
				break;
			}

			case "REQUEST_ANALYSIS": {
				if (!state.room) {
					send(state.ws, { type: "ERROR", message: "No active game" });
					return;
				}
				const suggestions = await state.room.getSuggestions();
				send(state.ws, suggestions);
				break;
			}

			case "SET_COACHING": {
				if (state.room) {
					state.room.coachingEnabled = msg.enabled;
				}
				break;
			}

			case "REQUEST_HINT": {
				if (!state.room) {
					send(state.ws, { type: "ERROR", message: "No active game" });
					return;
				}
				const hint = await state.room.getHint();
				if (hint) send(state.ws, hint);
				break;
			}

			case "PASS":
			case "JOIN_GAME":
				send(state.ws, { type: "ERROR", message: "Not implemented yet" });
				break;
		}
	}

	return wss;
}
