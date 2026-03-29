import type { ServerType } from "@hono/node-server";
import { ClientMessage } from "@tess/shared";
import { type WebSocket, WebSocketServer } from "ws";
import type { GameRoom } from "./gameRoom.js";
import { createLogger } from "./logger.js";
import type { SessionManager } from "./session.js";
import { Lobby, type LobbyClient } from "./lobby.js";
import { MultiplayerRoom, type MpClient } from "./multiplayerRoom.js";
import { evaluateMultiplayerGame } from "./postGameEval.js";

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
	autoplayElo: number;
	language?: string;
	lobbyClient: LobbyClient | null;
}

export function createWsServer(
	server: ServerType,
	sessionManager: SessionManager,
	federation?: import("./federation.js").FederationService,
): WebSocketServer {
	// biome-ignore lint: ServerType is compatible at runtime
	const wss = new WebSocketServer({ server: server as any });
	const clients = new Map<WebSocket, ClientState>();
	const lobby = new Lobby();
	const mpRooms = new Map<string, MultiplayerRoom>();

	// Periodic cleanup of finished MP rooms (every 60s)
	const roomCleanup = setInterval(() => {
		let cleaned = 0;
		for (const [id, room] of mpRooms) {
			if (room.status === "finished") {
				room.destroy();
				mpRooms.delete(id);
				cleaned++;
			}
		}
		if (cleaned > 0) log.info("cleaned up finished rooms", { cleaned, remaining: mpRooms.size });
	}, 60_000);

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

	wss.on("close", () => { clearInterval(heartbeat); clearInterval(roomCleanup); });

	wss.on("connection", (ws: WebSocket) => {
		(ws as unknown as { isAlive: boolean }).isAlive = true;
		ws.on("pong", () => {
			(ws as unknown as { isAlive: boolean }).isAlive = true;
		});

		const clientId = ++nextClientId;
		const state: ClientState = {
			_id: clientId,
			ws,
			room: null,
			mpRoom: null,
			inLobby: false,
			lobbyClient: null,
			suggestionCount: 3,
			autoplayElo: 2800,
			language: undefined,
			userId: `player-${clientId}-${Date.now().toString(36)}`,
		};
		log.info(`client #${state._id} connected`);
		// Subscribe to lobby for challenge notifications
		lobby.subscribe(getLobbyClient(state));
		clients.set(ws, state);
		log.info("client connected", { clients: clients.size });
		broadcastPlayerCounts();

		let processing = Promise.resolve();
		// Rate limiting: max 30 messages per second per client
		let msgCount = 0;
		let msgWindowStart = Date.now();
		const MSG_RATE_LIMIT = 30;
		const MSG_WINDOW_MS = 1000;

		ws.on("message", (data: Buffer) => {
			const now = Date.now();
			if (now - msgWindowStart > MSG_WINDOW_MS) {
				msgCount = 0;
				msgWindowStart = now;
			}
			msgCount++;
			if (msgCount > MSG_RATE_LIMIT) {
				log.warn("rate limited", { clientId: state._id, count: msgCount });
				return; // Drop message silently
			}
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
		const counts = {
			chess: 0, go: 0, janggi: 0, total: clients.size,
			remotePlayers: federation?.getRemotePlayerCount() ?? 0,
			federatedServers: federation?.getVerifiedPeers().length ?? 0,
		};
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
					userId: state.userId,
				});

				state.room = room;
				state.gameType = msg.gameType;
				if (msg.coaching !== undefined) room.coachingEnabled = msg.coaching;
				if (msg.suggestionCount !== undefined)
					room.suggestionCount = Math.min(3, Math.max(0, msg.suggestionCount));
				if (msg.suggestionStrength) room.suggestionStrength = msg.suggestionStrength;
				if (msg.language) {
					room.language = msg.language;
					state.language = msg.language;
				}

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
					if (!mpResult.ok)
						send(state.ws, { type: "ERROR", message: mpResult.error ?? "Invalid move" });

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
					// In multiplayer: two-pass analysis.
					// Pass 1 (fast): shallow search with 10 MultiPV to get a ranked move list.
					//   Elo determines which rank to pick: 800→10th, 1200→7th, 1600→4th, 2200→1st.
					// Pass 2 (full): deep search for accurate scoring + display suggestions.
					const elo = state.autoplayElo;
					try {
						let weakMove: string | null = null;
						if (elo < 2800) {
							if (state.mpRoom.gameType === "go") {
								// Go: use KataGo with low visits for weak play.
								// Lower-ranked suggestions from multi-PV provide natural weakness.
								// 800→rank 6, 1200→rank 4, 1600→rank 2, 2200→rank 0
								const weakResult = await sessionManager.analyzeFen(
									state.mpRoom.gameType,
									state.mpRoom.getFen(),
									8,
									state.mpRoom.getGoMoves(),
									state.mpRoom.getBoardSize(),
									state.mpRoom.getTurn(),
									10, // low visits = weaker analysis
								);
								if (weakResult.suggestions.length > 1) {
									const targetRank = Math.max(0, Math.round((2200 - elo) / 300));
									const rank = Math.min(targetRank, weakResult.suggestions.length - 1);
									weakMove = weakResult.suggestions[rank].move;
								}
							} else {
								// Chess/Janggi: 50ms MultiPV search + rank selection
								const weakResult = await sessionManager.analyzeFen(
									state.mpRoom.gameType,
									state.mpRoom.getFen(),
									10,
									state.mpRoom.getGoMoves(),
									state.mpRoom.getBoardSize(),
									state.mpRoom.getTurn(),
									50,
								);
								const validMoves = weakResult.suggestions.filter((s) => {
									if (s.move.length >= 4) {
										const from = s.move.slice(0, 2);
										const to = s.move.slice(2, 4);
										return from !== to;
									}
									return true;
								});
								if (validMoves.length > 0) {
									// Cap at rank 6 — rank 7-9 produce suicidal moves (king walks, hanging pieces)
									// 800→rank 6, 1200→rank 4, 1600→rank 2, 2200→rank 0
									const targetRank = Math.min(6, Math.max(0, Math.round((2200 - elo) / 250)));
									const variance = Math.floor(Math.random() * 3) - 1;
									const rank = Math.max(0, Math.min(validMoves.length - 1, targetRank + variance));
									weakMove = validMoves[rank].move;
								}
							}
						}

						// Control search for accurate scoring
						// Go needs more time (800ms) because KataGo needs visits to detect subtle mistakes
						// Chess/Janggi: 300ms is enough
						const controlTime = state.mpRoom.gameType === "go" ? 800 : 300;
						const mpSuggestions = await sessionManager.analyzeFen(
							state.mpRoom.gameType,
							state.mpRoom.getFen(),
							1,
							state.mpRoom.getGoMoves(),
							state.mpRoom.getBoardSize(),
							state.mpRoom.getTurn(),
							controlTime,
						);

						// Inject the weak move for the client's autoplay
						const payload: any = { ...mpSuggestions };
						if (weakMove) payload.weakMove = weakMove;
						send(state.ws, payload);

						// If engine returns no moves, the side to move has lost (checkmate/stalemate)
						if (mpSuggestions.suggestions.length === 0 && state.mpRoom.status === "playing") {
							const loser = state.mpRoom.getTurn();
							const winner = loser === "white" ? "black" : "white";
							log.info("no legal moves detected", { winner, loser });
							// Force game over via resignation on behalf of the losing side
							state.mpRoom.resign(toMpClient(state));
						}

						// Accumulate eval for post-game accuracy
						if (mpSuggestions.suggestions.length > 0) {
							const bestScore = mpSuggestions.suggestions[0].score;
							const turn = state.mpRoom.getTurn();
							// Normalize to white's perspective.
							// Go scores are now scoreLead * 100 (centipawn equivalent, doesn't saturate)
							const scoreWhitePov = turn === "white" ? bestScore : -bestScore;

							const history = state.mpRoom.getMoveHistory();
							const goMoves = state.mpRoom.getGoMoves();
							const moveCount = state.mpRoom.gameType === "go" ? goMoves.length : history.length;

							if (moveCount > 0) {
								// Record eval for the position after the last move
								state.mpRoom.recordPositionEval(scoreWhitePov);

								// Compute move quality from centipawn loss
								const preMoveScore = state.mpRoom.getPreMoveScore();
								const moverColor: "white" | "black" = turn === "white" ? "black" : "white";
								const evalBefore = moverColor === "white" ? preMoveScore : -preMoveScore;
								const evalAfter = moverColor === "white" ? scoreWhitePov : -scoreWhitePov;
								const cpLoss = Math.max(0, evalBefore - evalAfter);

								let quality: string;
								if (cpLoss <= 10) quality = "best";
								else if (cpLoss <= 25) quality = "good";
								else if (cpLoss <= 50) quality = "ok";
								else if (cpLoss <= 100) quality = "inaccuracy";
								else if (cpLoss <= 200) quality = "mistake";
								else quality = "blunder";

								const lastMove = history.length > 0 ? history[history.length - 1]?.uci : "";
								state.mpRoom.broadcastMessage({
									type: "MOVE_QUALITY",
									move: lastMove ?? "",
									quality,
								});
							}

							// Store as pre-move score for the NEXT move
							state.mpRoom.setPreMoveScore(scoreWhitePov);
						}
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
				// Store Elo for MP analysis movetime
				if (msg.humanElo) state.autoplayElo = msg.humanElo;
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

			case "UPDATE_SETTINGS": {
				if (msg.language) {
					state.language = msg.language;
					if (state.room) state.room.language = msg.language;
				}
				if (msg.coaching !== undefined && state.room) {
					state.room.coachingEnabled = msg.coaching;
				}
				if (msg.suggestionCount !== undefined) {
					state.suggestionCount = Math.min(3, Math.max(0, msg.suggestionCount));
					if (state.room) state.room.suggestionCount = state.suggestionCount;
				}
				if (msg.suggestionStrength && state.room) {
					state.room.suggestionStrength = msg.suggestionStrength;
				}
				break;
			}

			case "PASS": {
				if (state.mpRoom) {
					const passResult = state.mpRoom.playMove(toMpClient(state), "PASS");
					if (!passResult.ok)
						send(state.ws, { type: "ERROR", message: passResult.error ?? "Cannot pass" });
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
				// Nickname is display-only. userId is server-assigned and immutable.
				// This prevents impersonation via userId spoofing.
				if (state.lobbyClient) {
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
				if (!challenge) {
					send(state.ws, { type: "ERROR", message: "Too many active challenges" });
					break;
				}
				send(state.ws, {
					type: "CHALLENGE_CREATED",
					challengeId: challenge.id,
					code: challenge.code,
				});
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
				log.info("ACCEPT_CHALLENGE", {
					creatorFound: !!creatorState,
					creatorUserId: entry.creator.userId,
					acceptorId: state._id,
					creatorId: creatorState?._id,
				});
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
				const acceptorColor =
					ch.creatorColor === "white" ? "black" : ch.creatorColor === "black" ? "white" : undefined;
				room.addPlayer(toMpClient(state), acceptorColor);
				state.mpRoom = room;
				mpRooms.set(room.id, room);
				lobby.removeChallenge(ch.id);
				// Stop singleplayer rooms from sending stale messages during MP
				if (creatorState.room) {
					creatorState.room.destroy();
					creatorState.room = null;
				}
				if (state.room) {
					state.room.destroy();
					state.room = null;
				}
				// Set up post-game evaluation
				// Post-game evaluation (extracted to postGameEval.ts)
				room.onGameEnd(async (r) => {
					try {
						await evaluateMultiplayerGame(
							r,
							{ ws: creatorState.ws, mpRoom: creatorState.mpRoom, language: creatorState.language },
							{ ws: state.ws, mpRoom: state.mpRoom, language: state.language },
							ch.creatorColor ?? "white",
							sessionManager,
							send,
						);
					} catch (err) {
						log.error("MP eval failed", { error: (err as Error).message });
					}
				});
				log.info("MP game started", {
					gameId: room.id,
					creator: creatorState.userId,
					acceptor: state.userId,
				});
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
						// Stop singleplayer room from interfering
						if (creator2.room) {
							creator2.room.destroy();
							creator2.room = null;
						}
					}
					if (msg.spectate) {
						room2.addSpectator(toMpClient(state));
					} else {
						room2.addPlayer(toMpClient(state));
					}
					state.mpRoom = room2;
					// Stop singleplayer room from interfering
					if (state.room) {
						state.room.destroy();
						state.room = null;
					}
					mpRooms.set(room2.id, room2);
					// Post-game evaluation for code-joined games
					room2.onGameEnd(async (r) => {
						try {
							await evaluateMultiplayerGame(
								r,
								{
									ws: (creator2 ?? state).ws,
									mpRoom: (creator2 ?? state).mpRoom,
									language: (creator2 ?? state).language,
								},
								{ ws: state.ws, mpRoom: state.mpRoom, language: state.language },
								ch2.creatorColor ?? "white",
								sessionManager,
								send,
							);
						} catch (err) {
							log.error("MP eval failed (code join)", { error: (err as Error).message });
						}
					});
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

			case "PRESET_MESSAGE": {
				if (state.mpRoom) state.mpRoom.sendPresetMessage(toMpClient(state), msg.message);
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

			case "REMATCH": {
				const oldRoom = state.mpRoom;
				if (!oldRoom || oldRoom.status !== "finished") {
					send(state.ws, { type: "ERROR", message: "No finished game to rematch" });
					break;
				}

				const myClient = toMpClient(state);
				const myColor = oldRoom.getPlayerColor(myClient);
				if (!myColor) {
					send(state.ws, { type: "ERROR", message: "You are not a player in this game" });
					break;
				}

				// Find opponent's ClientState
				const opponentColor = myColor === "white" ? "black" : "white";
				const opponentMpClient = oldRoom.getPlayer(opponentColor);
				if (!opponentMpClient) {
					send(state.ws, { type: "ERROR", message: "Opponent not found" });
					break;
				}
				const opponentState = findClientByUserId(opponentMpClient.userId);
				if (!opponentState) {
					send(state.ws, { type: "ERROR", message: "Opponent disconnected" });
					break;
				}

				// Create new room — use requested gameType or keep same, swapped colors
				const settings = oldRoom.getSettings();
				const newGameType = msg.gameType ?? settings.gameType;
				const newRoomId = `rematch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
				const newCode = oldRoom.code;
				const newRoom = new MultiplayerRoom({
					id: newRoomId,
					code: newCode,
					gameType: newGameType,
					timeControl: settings.timeControl,
					boardSize: settings.boardSize,
				});

				// Pass metadata (e.g., autoplay flag) through to MP_GAME_START
				if (msg.autoplay) {
					newRoom.setStartMetadata({ autoplay: true });
				}

				// Swap colors: whoever was white is now black and vice versa
				const myNewColor = myColor === "white" ? "black" : "white";
				const opponentNewColor = opponentColor === "white" ? "black" : "white";
				newRoom.addPlayer(myClient, myNewColor);
				newRoom.addPlayer(toMpClient(opponentState), opponentNewColor);

				// Clean up old room
				oldRoom.destroy();
				mpRooms.delete(oldRoom.id);

				// Assign new room to both players
				state.mpRoom = newRoom;
				opponentState.mpRoom = newRoom;
				mpRooms.set(newRoom.id, newRoom);

				// Set up post-game evaluation for the new room
				newRoom.onGameEnd(async (r) => {
					try {
						await evaluateMultiplayerGame(
							r,
							{ ws: state.ws, mpRoom: state.mpRoom, language: state.language },
							{
								ws: opponentState.ws,
								mpRoom: opponentState.mpRoom,
								language: opponentState.language,
							},
							myNewColor,
							sessionManager,
							send,
						);
					} catch (err) {
						log.error("MP eval failed (rematch)", { error: (err as Error).message });
					}
				});

				log.info("Rematch started", {
					gameId: newRoom.id,
					player1: state.userId,
					player2: opponentState.userId,
				});
				break;
			}

			case "MP_LEAVE": {
				const room = state.mpRoom;
				if (!room) break;

				const client = toMpClient(state);
				const playerColor = room.getPlayerColor(client);

				// Resign if game in progress
				if (room.status === "playing" && playerColor) {
					room.resign(client);
				}

				// Notify opponent
				if (playerColor) {
					const oppColor = playerColor === "white" ? "black" : "white";
					const oppMpClient = room.getPlayer(oppColor);
					if (oppMpClient) {
						oppMpClient.send({ type: "MP_SESSION_END" });
						// Clear opponent's mpRoom
						const oppState = findClientByUserId(oppMpClient.userId);
						if (oppState) oppState.mpRoom = null;
					}
				}

				// Clean up
				room.destroy();
				mpRooms.delete(room.id);
				state.mpRoom = null;
				break;
			}
		}
	}

	function findClientByUserId(userId: string): ClientState | undefined {
		for (const [, s] of clients) {
			if (s.userId === userId) return s;
		}
		return undefined;
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
			get userId() {
				return state.userId ?? "anon";
			},
			get nickname() {
				return state.nickname;
			},
			send: (msg) => send(state.ws, msg),
		};
	}

	return wss;
}
