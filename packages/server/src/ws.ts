import type { ServerType } from "@hono/node-server";
import { ClientMessage } from "@tess/shared";
import { type WebSocket, WebSocketServer } from "ws";
import type { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";
import type { SessionManager } from "./session.js";
import { Lobby, type LobbyClient } from "./lobby.js";
import { MultiplayerRoom, type MpClient } from "./multiplayerRoom.js";
import { ChessGame, JanggiGame, gameAccuracy, getSkillLevel } from "@tess/shared";
import { generateGameSummary } from "./ai.js";

const log = createLogger("ws");

let nextClientId = 0;

interface ClientState {
	_id: number;
	ws: WebSocket;
	room: GameRoom | null;
	mpRoom: MultiplayerRoom | null;
	userId?: string;
	nickname?: string;
	gameType?: string;
	inLobby: boolean;
	suggestionCount: number;
	language?: string;
	lobbyClient: LobbyClient | null;
}

export function createWsServer(
	server: ServerType,
	sessionManager: SessionManager,
): WebSocketServer {
	// biome-ignore lint: ServerType is compatible at runtime
	const wss = new WebSocketServer({ server: server as any });
	const clients = new Map<WebSocket, ClientState>();
	const lobby = new Lobby();
	const mpRooms = new Map<string, MultiplayerRoom>();

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

		const state: ClientState = { _id: ++nextClientId, ws, room: null, mpRoom: null, inLobby: false, lobbyClient: null, suggestionCount: 3, language: undefined, userId: `player-${++nextClientId}` };
		log.info(`client #${state._id} connected`);
		// Auto-subscribe to lobby for challenge notifications
		setTimeout(() => lobby.subscribe(getLobbyClient(state)), 100);
		clients.set(ws, state);
		log.info("client connected", { clients: clients.size });
		broadcastPlayerCounts();

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
			if (clientState?.mpRoom) {
				const mpClient = toMpClient(clientState);
				clientState.mpRoom.handleDisconnect(mpClient);
			}
			if (clientState) {
				const lobbyClient = getLobbyClient(clientState);
				lobby.removeClientChallenges(lobbyClient);
				lobby.unsubscribe(lobbyClient);
			}
			clients.delete(ws);
			log.info("client disconnected", { clients: clients.size });
			broadcastPlayerCounts();
		});

		ws.on("error", (err) => {
			log.error("ws error", { error: err.message });
		});
	});

	function broadcastPlayerCounts(): void {
		const counts = { chess: 0, go: 0, janggi: 0, total: clients.size };
		for (const [, state] of clients) {
			if (state.gameType === "chess") counts.chess++;
			else if (state.gameType === "go") counts.go++;
			else if (state.gameType === "janggi") counts.janggi++;
		}
		const msg = JSON.stringify({ type: "PLAYER_COUNT", ...counts });
		for (const ws of wss.clients) {
			if (ws.readyState === ws.OPEN) ws.send(msg);
		}
	}

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
					boardSize: msg.boardSize,
				});

				state.room = room;
				state.gameType = msg.gameType;
				if (msg.coaching !== undefined) room.coachingEnabled = msg.coaching;
				if (msg.suggestionCount !== undefined)
					room.suggestionCount = Math.min(3, Math.max(0, msg.suggestionCount));
				if (msg.suggestionStrength) room.suggestionStrength = msg.suggestionStrength;
				if (msg.language) { room.language = msg.language; state.language = msg.language; }

				room.onMove((data) => send(state.ws, data));
				send(state.ws, room.getState());
				broadcastPlayerCounts();

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
				if (state.mpRoom) {
					const mpResult = state.mpRoom.playMove(toMpClient(state), msg.move);
					if (!mpResult.ok) send(state.ws, { type: "ERROR", message: mpResult.error ?? "Invalid move" });

					break;
				}
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
				if (state.mpRoom) {
					state.mpRoom.resign(toMpClient(state));
					break;
				}
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
				if (state.mpRoom && state.mpRoom.status === "playing") {
					// In multiplayer: get suggestions from engine for current MP position
					if (state.suggestionCount <= 0) {
						send(state.ws, { type: "SUGGESTIONS", suggestions: [] });
						break;
					}
					try {
						const mpSuggestions = await sessionManager.analyzeFen(
							state.mpRoom.gameType,
							state.mpRoom.getFen(),
							state.suggestionCount,
							state.mpRoom.getGoMoves(),
							state.mpRoom.getBoardSize(),
						);
						send(state.ws, mpSuggestions);
					} catch (err) {
						log.error("MP analysis failed", { error: (err as Error).message });
						send(state.ws, { type: "SUGGESTIONS", suggestions: [] });
					}
					break;
				}
				if (!state.room) {
					send(state.ws, { type: "ERROR", message: "No active game" });
					return;
				}
				const suggestions = await state.room.getSuggestions();
				send(state.ws, suggestions);
				break;
			}

			case "SET_COACHING": {
				if (state.room) state.room.coachingEnabled = msg.enabled;
				break;
			}

			case "AUTOPLAY": {
				if (!state.room) return;
				if (msg.enabled) {
					state.room.startAutoplay(msg.humanElo ?? null);
				} else {
					state.room.stopAutoplay();
				}
				break;
			}

			case "SET_SUGGESTIONS": {
				state.suggestionCount = Math.min(3, Math.max(0, msg.count));
				if (state.room) state.room.suggestionCount = state.suggestionCount;
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

			case "PASS": {
				if (state.mpRoom) {
					const passResult = state.mpRoom.playMove(toMpClient(state), "PASS");
					if (!passResult.ok) send(state.ws, { type: "ERROR", message: passResult.error ?? "Cannot pass" });
				} else if (state.room?.gameType === "go") {
					await state.room.playMove("PASS");
				}
				break;
			}

			case "JOIN_GAME":
				send(state.ws, { type: "ERROR", message: "Use JOIN_BY_CODE for multiplayer" });
				break;

			// ── Multiplayer messages ──

			case "SET_NICKNAME": {
				const name = msg.nickname.trim().slice(0, 20);
				if (!name) break;
				state.nickname = name;
				// Use bird-name as userId, keep nickname as display override
				// First SET_NICKNAME sets the base userId (bird-name)
				if (state.userId?.startsWith("player-")) {
					state.userId = name;
				}
				// Update lobbyClient to reflect new name
				if (state.lobbyClient) {
					state.lobbyClient.userId = state.userId!;
					state.lobbyClient.nickname = state.nickname;
				}
				send(state.ws, { type: "NICKNAME_SET", nickname: state.nickname });
				break;
			}

			case "REQUEST_LOBBY": {
				state.inLobby = true;
				lobby.subscribe(getLobbyClient(state));
				break;
			}

			case "LEAVE_LOBBY": {
				state.inLobby = false;
				lobby.unsubscribe(getLobbyClient(state));
				break;
			}

			case "CREATE_CHALLENGE": {
				const challenge = lobby.createChallenge(
					getLobbyClient(state),
					msg.gameType,
					msg.timeControl,
					msg.color,
					msg.boardSize,
				);
				send(state.ws, { type: "CHALLENGE_CREATED", challengeId: challenge.id, code: challenge.code });
				break;
			}

			case "CANCEL_CHALLENGE": {
				lobby.cancelChallenge(getLobbyClient(state), msg.challengeId);
				break;
			}

			case "ACCEPT_CHALLENGE": {
				const entry = lobby.getChallenge(msg.challengeId);
				if (!entry) {
					send(state.ws, { type: "ERROR", message: "Challenge not found" });
					break;
				}
				const ch = entry.challenge;
				// Find creator by matching lobbyClient reference
				const creatorState = findClientByLobbyClient(entry.creator);
				log.info("ACCEPT_CHALLENGE", { creatorFound: !!creatorState, creatorUserId: entry.creator.userId, acceptorId: state._id, creatorId: creatorState?._id });
				if (!creatorState) {
					send(state.ws, { type: "ERROR", message: "Challenge creator disconnected" });
					lobby.removeChallenge(ch.id);
					break;
				}
				const room = new MultiplayerRoom({
					id: ch.id,
					code: ch.code,
					gameType: ch.gameType,
					timeControl: ch.timeControl,
					boardSize: ch.boardSize,
				});
				// Add creator as first player
				room.addPlayer(toMpClient(creatorState), ch.creatorColor);
				creatorState.mpRoom = room;
				// Add acceptor as second player
				const acceptorColor = ch.creatorColor === "white" ? "black" : ch.creatorColor === "black" ? "white" : undefined;
				room.addPlayer(toMpClient(state), acceptorColor);
				state.mpRoom = room;
				mpRooms.set(room.id, room);
				lobby.removeChallenge(ch.id);
				// Keep singleplayer rooms alive for engine analysis in MP
				// Set up post-game evaluation
				room.onGameEnd(async (r) => {
					try {
						const history = r.getMoveHistory();
						const moveCount = r.gameType === "go" ? r.getGoMoves().length : history.length;
						if (moveCount < 4) return;

						// Branch by game type for evaluation
						if (r.gameType === "go") {
							// Chess/Janggi eval loop didn't run — do simple Go scoring
							// For Go, accuracy is harder to compute without KataGo replay
							// Use a simplified approach based on final result
							const goResult = r.getResult();
							// Estimate accuracy from margin of victory
							const margin = parseFloat(goResult.reason.replace(/[^0-9.]/g, "")) || 0;
							const winnerAcc = Math.min(95, 70 + margin * 0.5);
							const loserAcc = Math.max(20, 70 - margin * 0.5);
							const wAcc = goResult.winner === "white" ? winnerAcc : loserAcc;
							const bAcc = goResult.winner === "black" ? winnerAcc : loserAcc;
							const wSkill = getSkillLevel(Math.round(wAcc), r.gameType);
							const bSkill = getSkillLevel(Math.round(bAcc), r.gameType);
							const creatorColor = ch.creatorColor ?? "white";
							const acceptorColorActual = creatorColor === "white" ? "black" : "white";
							const cAcc = creatorColor === "white" ? wAcc : bAcc;
							const cSkill = creatorColor === "white" ? wSkill : bSkill;
							const aAcc = acceptorColorActual === "white" ? wAcc : bAcc;
							const aSkill = acceptorColorActual === "white" ? wSkill : bSkill;
							if (creatorState.mpRoom === r) send(creatorState.ws, { type: "SKILL_EVAL", accuracy: Math.round(cAcc), acpl: 0, skill: cSkill });
							if (state.mpRoom === r) send(state.ws, { type: "SKILL_EVAL", accuracy: Math.round(aAcc), acpl: 0, skill: aSkill });
							log.info("Go MP eval (simplified)", { whiteAcc: Math.round(wAcc), blackAcc: Math.round(bAcc) });
							// Generate AI summaries for Go
							const goGameResult = r.getResult();
							try {
								const [goCs, goAs] = await Promise.allSettled([
									generateGameSummary({
										gameType: "go",
										playerColor: creatorColor,
										accuracy: Math.round(cAcc),
										acpl: 0,
										skillLabel: cSkill.label,
										skillRating: cSkill.rating,
										totalMoves: moveCount,
										result: goGameResult.reason,
										language: creatorState.language,
									}),
									generateGameSummary({
										gameType: "go",
										playerColor: acceptorColorActual,
										accuracy: Math.round(aAcc),
										acpl: 0,
										skillLabel: aSkill.label,
										skillRating: aSkill.rating,
										totalMoves: moveCount,
										result: goGameResult.reason,
										language: state.language,
									}),
								]);
								if (goCs.status === "fulfilled" && goCs.value && creatorState.mpRoom === r) {
									send(creatorState.ws, { type: "GAME_SUMMARY", text: goCs.value });
								}
								if (goAs.status === "fulfilled" && goAs.value && state.mpRoom === r) {
									send(state.ws, { type: "GAME_SUMMARY", text: goAs.value });
								}
							} catch (err) {
								log.error("Go summary failed", { error: (err as Error).message });
							}
						} else {
							// Chess/Janggi: replay and evaluate each position
							const evals: number[] = [0];
							const replay = r.gameType === "janggi" ? new JanggiGame() : new ChessGame();
							const pool = r.gameType === "janggi" && sessionManager.hasJanggiPool
								? sessionManager.getJanggiPool()! : sessionManager.getChessPool();
							const variant = r.gameType === "janggi" ? "janggi" : undefined;
							for (const move of history) {
								replay.moveUci(move.uci);
								try {
									const res = await pool.search(replay.fen, 300, 1, variant);
									const score = res.info[0]?.score ?? 0;
									evals.push(replay.turn === "white" ? score : -score);
								} catch {
									evals.push(evals[evals.length - 1] ?? 0);
								}
							}
							log.info("MP evals", { moves: history.length, evalsLength: evals.length, evals: evals.slice(0, 20) });
							// Calculate accuracy for both colors
							const whiteResult = gameAccuracy(evals, "white", 3);
							const whiteSkill = getSkillLevel(Math.round(whiteResult.accuracy), r.gameType, whiteResult.acpl);
							const blackResult = gameAccuracy(evals, "black", 3);
							const blackSkill = getSkillLevel(Math.round(blackResult.accuracy), r.gameType, blackResult.acpl);
							log.info("MP accuracy", { whiteAcc: Math.round(whiteResult.accuracy), whiteAcpl: whiteResult.acpl, blackAcc: Math.round(blackResult.accuracy), blackAcpl: blackResult.acpl });
							// Send to each player based on their ACTUAL color
							const creatorColor = ch.creatorColor ?? "white";
							const acceptorColorActual = creatorColor === "white" ? "black" : "white";
							const creatorResult = creatorColor === "white" ? whiteResult : blackResult;
							const creatorSkill = creatorColor === "white" ? whiteSkill : blackSkill;
							const acceptorResult = acceptorColorActual === "white" ? whiteResult : blackResult;
							const acceptorSkill = acceptorColorActual === "white" ? whiteSkill : blackSkill;
							if (creatorState.mpRoom === r) {
								send(creatorState.ws, { type: "SKILL_EVAL", accuracy: Math.round(creatorResult.accuracy), acpl: creatorResult.acpl, skill: creatorSkill });
							}
							if (state.mpRoom === r) {
								send(state.ws, { type: "SKILL_EVAL", accuracy: Math.round(acceptorResult.accuracy), acpl: acceptorResult.acpl, skill: acceptorSkill });
							}
							log.info("MP skill eval done", { white: Math.round(whiteResult.accuracy), black: Math.round(blackResult.accuracy) });
							// Generate SEPARATE AI summaries for each player (parallel)
							const pgn = history.map((m, i) => (i % 2 === 0 ? `${Math.floor(i/2)+1}. ${m.san}` : m.san)).join(" ");
							const gameResult = r.status === "finished" ? "Checkmate" : "Game over";
							try {
								const [cs, as_] = await Promise.allSettled([
									generateGameSummary({
										gameType: r.gameType,
										playerColor: creatorColor,
										accuracy: Math.round(creatorResult.accuracy),
										acpl: creatorResult.acpl,
										skillLabel: creatorSkill.label,
										skillRating: creatorSkill.rating,
										totalMoves: history.length,
										result: gameResult,
										pgn,
										moveAccuracies: creatorResult.moveAccuracies,
										language: creatorState.language,
									}),
									generateGameSummary({
										gameType: r.gameType,
										playerColor: acceptorColorActual,
										accuracy: Math.round(acceptorResult.accuracy),
										acpl: acceptorResult.acpl,
										skillLabel: acceptorSkill.label,
										skillRating: acceptorSkill.rating,
										totalMoves: history.length,
										result: gameResult,
										pgn,
										moveAccuracies: acceptorResult.moveAccuracies,
										language: state.language,
									}),
								]);
								if (cs.status === "fulfilled" && cs.value && creatorState.mpRoom === r) {
									send(creatorState.ws, { type: "GAME_SUMMARY", text: cs.value });
								}
								if (as_.status === "fulfilled" && as_.value && state.mpRoom === r) {
									send(state.ws, { type: "GAME_SUMMARY", text: as_.value });
								}
								log.info("MP summaries sent", { creator: cs.status, acceptor: as_.status });
							} catch (err) {
								log.error("MP game summary failed", { error: (err as Error).message });
							}
							} // end else (chess/janggi)
					} catch (err) {
						log.error("MP eval failed", { error: (err as Error).message });
					}
				});
				log.info("MP game started", { gameId: room.id, creator: creatorState.userId, acceptor: state.userId });
				break;
			}

			case "JOIN_BY_CODE": {
				// Check lobby challenges first
				const codeEntry = lobby.getByCode(msg.code);
				if (codeEntry) {
					// Same as ACCEPT_CHALLENGE
					const ch2 = codeEntry.challenge;
					const room2 = new MultiplayerRoom({
						id: ch2.id,
						code: ch2.code,
						gameType: ch2.gameType,
						timeControl: ch2.timeControl,
						boardSize: ch2.boardSize,
					});
					const creator2 = findClientByLobbyClient(codeEntry.creator);
					if (creator2) {
						room2.addPlayer(toMpClient(creator2), ch2.creatorColor);
						creator2.mpRoom = room2;
					}
					if (msg.spectate) {
						room2.addSpectator(toMpClient(state));
					} else {
						room2.addPlayer(toMpClient(state));
					}
					state.mpRoom = room2;
					mpRooms.set(room2.id, room2);
					lobby.removeChallenge(ch2.id);
					break;
				}
				// Check active rooms
				for (const room of mpRooms.values()) {
					if (room.code === msg.code.toUpperCase()) {
						if (msg.spectate) {
							room.addSpectator(toMpClient(state));
						} else {
							room.addPlayer(toMpClient(state));
						}
						state.mpRoom = room;
						break;
					}
				}
				if (!state.mpRoom) {
					send(state.ws, { type: "ERROR", message: "Game not found" });
				}
				break;
			}

			case "EMOJI_REACTION": {
				if (state.mpRoom) state.mpRoom.sendEmoji(toMpClient(state), msg.emoji);
				break;
			}

			case "OFFER_DRAW": {
				if (state.mpRoom) state.mpRoom.offerDraw(toMpClient(state));
				break;
			}

			case "RESPOND_DRAW": {
				if (state.mpRoom) state.mpRoom.respondDraw(toMpClient(state), msg.accept);
				break;
			}
		}
	}


	function findClientByLobbyClient(lobbyClient: LobbyClient): ClientState | undefined {
		// First try exact reference match
		for (const [, s] of clients) {
			if (s.lobbyClient === lobbyClient) return s;
		}
		// Fall back to userId match (covers reconnects where reference changes)
		const targetId = lobbyClient.userId;
		if (targetId && targetId !== "anon") {
			for (const [, s] of clients) {
				if (s.userId === targetId || s.nickname === targetId) return s;
			}
		}
		log.warn("findClientByLobbyClient: no match", { userId: lobbyClient.userId });
		return undefined;
	}

	function findClientByUserId(userId: string): ClientState | undefined {
		for (const [, s] of clients) {
			if (s.userId === userId) return s;
		}
		return undefined;
	}

	function getLobbyClient(state: ClientState): LobbyClient {
		if (!state.lobbyClient) {
			state.lobbyClient = {
				userId: state.userId ?? "anon",
				nickname: state.nickname,
				send: (msg) => send(state.ws, msg),
			};
		}
		// Keep nickname in sync
		state.lobbyClient.nickname = state.nickname;
		state.lobbyClient.userId = state.userId ?? "anon";
		return state.lobbyClient;
	}

	function toMpClient(state: ClientState): MpClient {
		// Closure captures `state` (not ws) so it follows reconnections
		return {
			get userId() { return state.userId ?? "anon"; },
			get nickname() { return state.nickname; },
			send: (msg) => send(state.ws, msg),
		};
	}

	return wss;
}