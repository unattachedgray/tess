/**
 * MultiplayerRoom — manages a PvP game between two human players.
 *
 * Separate from GameRoom (which handles singleplayer vs AI).
 * Reuses the same shared game engines (ChessGame, GoGame, JanggiGame).
 */
import { ChessGame, GoGame, JanggiGame } from "@tess/shared";
import { gameAccuracy, getSkillLevel } from "@tess/shared";
import type { GameType, TimeControl } from "@tess/shared";
import { FischerClock, type ClockState } from "./clock.js";
import { createLogger } from "./logger.js";
const log = createLogger("mp");

export interface MpClient {
	userId: string;
	nickname?: string;
	send: (msg: unknown) => void;
}

export type RoomStatus = "waiting" | "playing" | "finished";

export class MultiplayerRoom {
	readonly id: string;
	readonly code: string;
	readonly gameType: GameType;
	readonly timeControl: TimeControl;
	readonly boardSize: number;

	private game: ChessGame | GoGame | JanggiGame;
	private clock: FischerClock | null = null;
	private players: { white: MpClient | null; black: MpClient | null } = {
		white: null,
		black: null,
	};
	private spectators = new Set<MpClient>();
	private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private pendingDraw: "white" | "black" | null = null;
	status: RoomStatus = "waiting";
	private onGameEndCallback: ((room: MultiplayerRoom) => void) | null = null;
	private startMetadata: Record<string, unknown> = {};

	// Incremental eval accumulation (scores from white's perspective)
	private positionEvals: number[] = [0]; // evals[0] = starting position = 0
	private lastPreMoveScore = 0; // score before the most recent move

	constructor(opts: {
		id: string;
		code: string;
		gameType: GameType;
		timeControl: TimeControl;
		boardSize?: number;
	}) {
		this.id = opts.id;
		this.code = opts.code;
		this.gameType = opts.gameType;
		this.timeControl = opts.timeControl;
		this.boardSize = opts.boardSize ?? 19;

		// Create game instance
		if (opts.gameType === "go") {
			this.game = new GoGame(this.boardSize);
		} else if (opts.gameType === "janggi") {
			this.game = new JanggiGame();
		} else {
			this.game = new ChessGame();
		}
	}

	/** Add a player to the room. Returns the assigned color. */
	addPlayer(client: MpClient, preferredColor?: "white" | "black"): "white" | "black" | null {
		// If this player is reconnecting, restore them
		// Only match real userIds, not auto-generated ones
		if (client.userId && !client.userId.startsWith("player-")) {
			const existingSlot = this.findPlayerSlot(client.userId);
			if (existingSlot) {
				this.players[existingSlot] = client;
				this.handleReconnect(client, existingSlot);
				return existingSlot;
			}
		}

		// Assign color
		let color: "white" | "black";
		if (preferredColor && !this.players[preferredColor]) {
			color = preferredColor;
		} else if (!this.players.white) {
			color = "white";
		} else if (!this.players.black) {
			color = "black";
		} else {
			return null; // Room full — join as spectator
		}

		this.players[color] = client;

		// If both players are in, start the game
		if (this.players.white && this.players.black && this.status === "waiting") {
			this.startGame();
		}

		return color;
	}

	/** Add a spectator. */
	addSpectator(client: MpClient): void {
		this.spectators.add(client);
		this.broadcastSpectatorCount();

		// Send current game state if game is in progress
		if (this.status === "playing" || this.status === "finished") {
			client.send(this.buildGameState("white")); // Spectators see white's perspective
			if (this.clock && !this.clock.isUntimed()) {
				client.send({ type: "CLOCK_UPDATE", ...this.clock.getState() });
			}
		}
	}

	removeSpectator(client: MpClient): void {
		this.spectators.delete(client);
		this.broadcastSpectatorCount();
	}

	/** Handle a player disconnecting — start grace period. */
	handleDisconnect(client: MpClient): void {
		const slot = this.findPlayerSlot(client.userId);
		if (!slot) {
			this.spectators.delete(client);
			this.broadcastSpectatorCount();
			return;
		}

		if (this.status !== "playing") {
			// Game not started — just remove
			this.players[slot] = null;
			return;
		}

		const GRACE_PERIOD = 60_000; // 60 seconds
		log.info(`Player ${client.userId} disconnected from ${this.id}, ${GRACE_PERIOD / 1000}s grace`);

		// Pause clock
		this.clock?.pause();

		// Notify opponent
		const opponent = slot === "white" ? this.players.black : this.players.white;
		if (opponent) {
			opponent.send({ type: "OPPONENT_DISCONNECTED", gracePeriod: GRACE_PERIOD });
		}

		// Start grace timer
		const timer = setTimeout(() => {
			this.disconnectTimers.delete(client.userId);
			// Opponent wins by abandonment
			this.endGame(slot === "white" ? "black" : "white", "abandonment");
		}, GRACE_PERIOD);
		this.disconnectTimers.set(client.userId, timer);
	}

	private handleReconnect(client: MpClient, slot: "white" | "black"): void {
		// Cancel grace timer
		const timer = this.disconnectTimers.get(client.userId);
		if (timer) {
			clearTimeout(timer);
			this.disconnectTimers.delete(client.userId);
		}

		log.info(`Player ${client.userId} reconnected to ${this.id}`);

		// Notify opponent
		const opponent = slot === "white" ? this.players.black : this.players.white;
		if (opponent) {
			opponent.send({ type: "OPPONENT_RECONNECTED" });
		}

		// Send full game state to reconnecting player
		client.send(this.buildGameState(slot));
		if (this.clock && !this.clock.isUntimed()) {
			client.send({ type: "CLOCK_UPDATE", ...this.clock.getState() });
		}

		// Resume clock
		if (this.status === "playing") {
			const turn = this.getCurrentTurn();
			this.clock?.start(turn);
		}
	}

	/** Play a move. Validates turn and legality. */
	playMove(client: MpClient, move: string): { ok: boolean; error?: string } {
		if (this.status !== "playing") {
			return { ok: false, error: "Game not in progress" };
		}

		const playerColor = this.getPlayerColor(client);
		if (!playerColor) {
			return { ok: false, error: "You are not a player in this game" };
		}

		const turn = this.getCurrentTurn();
		if (playerColor !== turn) {
			return { ok: false, error: "Not your turn" };
		}

		// Execute move
		try {
			if (this.game instanceof GoGame) {
				if (move.toUpperCase() === "PASS") {
					this.game.pass();
				} else {
					const GO_COLS = "ABCDEFGHJKLMNOPQRST";
					const col = GO_COLS.indexOf(move[0]?.toUpperCase());
					const row = parseInt(move.slice(1), 10);
					if (col < 0 || isNaN(row)) return { ok: false, error: "Invalid move" };
					const ok = this.game.play(col, this.boardSize - row);
					if (!ok) return { ok: false, error: "Illegal move" };
				}
			} else {
				this.game.moveUci(move);
			}
		} catch (e) {
			return { ok: false, error: `Invalid move: ${e}` };
		}

		// Switch clock
		this.clock?.switchSide();

		// Clear pending draw offers
		this.pendingDraw = null;

		// Broadcast move to all
		const movePayload = this.buildMovePayload(move);
		this.broadcast(movePayload);

		// Check game over — delay so client renders the final move first
		if (this.isGameOver()) {
			const result = this.getResult();
			const fen = this.game instanceof GoGame ? "(go)" : this.game.fen;
			log.info("game over detected", {
				reason: result.reason,
				winner: result.winner,
				fen,
				lastMove: move,
			});
			setTimeout(() => this.endGame(result.winner, result.reason), 500);
		}

		return { ok: true };
	}

	/** Handle emoji reaction. */
	sendEmoji(from: MpClient, emoji: string): void {
		const fromColor = this.getPlayerColor(from);
		if (!fromColor) return; // Spectators can't send emoji
		const fromName = from.nickname || from.userId;

		// Send to opponent only (not back to sender)
		const opponent = fromColor === "white" ? this.players.black : this.players.white;
		if (opponent) {
			opponent.send({ type: "EMOJI_RECEIVED", emoji, from: fromName });
		}
	}

	/** Handle preset message. */
	sendPresetMessage(from: MpClient, message: string): void {
		const fromColor = this.getPlayerColor(from);
		if (!fromColor) return;
		const fromName = from.nickname || from.userId;

		const opponent = fromColor === "white" ? this.players.black : this.players.white;
		if (opponent) {
			opponent.send({ type: "PRESET_MESSAGE_RECEIVED", message, from: fromName });
		}
	}

	/** Offer a draw. */
	offerDraw(from: MpClient): void {
		const fromColor = this.getPlayerColor(from);
		if (!fromColor || this.status !== "playing") return;

		this.pendingDraw = fromColor;
		const opponent = fromColor === "white" ? this.players.black : this.players.white;
		if (opponent) {
			opponent.send({ type: "DRAW_OFFER" });
		}
	}

	/** Respond to a draw offer. */
	respondDraw(from: MpClient, accept: boolean): void {
		const fromColor = this.getPlayerColor(from);
		if (!fromColor || !this.pendingDraw || this.pendingDraw === fromColor) return;

		if (accept) {
			this.endGame("draw", "agreement");
		} else {
			const offererColor = this.pendingDraw;
			this.pendingDraw = null;
			const offerer = offererColor === "white" ? this.players.white : this.players.black;
			if (offerer) {
				offerer.send({ type: "DRAW_RESPONSE", accepted: false });
			}
		}
	}

	/** Handle resignation. */
	resign(client: MpClient): void {
		const color = this.getPlayerColor(client);
		if (!color || this.status !== "playing") return;
		this.endGame(color === "white" ? "black" : "white", "resignation");
	}

	/** Get player count (for lobby display). */
	getPlayerCount(): number {
		return (this.players.white ? 1 : 0) + (this.players.black ? 1 : 0);
	}

	getSpectatorCount(): number {
		return this.spectators.size;
	}

	/** Set callback for post-game evaluation. */
	onGameEnd(cb: (room: MultiplayerRoom) => void): void {
		this.onGameEndCallback = cb;
	}

	/** Get full move history for post-game analysis. */
	getMoveHistory(): { san: string; uci: string; fen: string; moveNumber: number }[] {
		if (this.game instanceof GoGame) return [];
		return this.game.getMoveHistory();
	}

	/** Get Go move history in KataGo format. */
	getGoMoves(): [string, string][] {
		if (this.game instanceof GoGame) {
			return this.game.getKataGoMoves();
		}
		return [];
	}

	getBoardSize(): number {
		return this.boardSize;
	}

	/** Get current position FEN (for engine analysis). */
	getTurn(): "white" | "black" {
		return this.game.turn;
	}

	getFen(): string {
		if (this.game instanceof GoGame) return "";
		return this.game.fen;
	}

	// ── Incremental eval ──

	/** Record a position eval after a move was played.
	 *  @param scoreWhitePov engine score from white's perspective (centipawns) */
	recordPositionEval(scoreWhitePov: number): void {
		this.positionEvals.push(scoreWhitePov);
	}

	/** Store the pre-move score (eval of the position before the move). */
	setPreMoveScore(score: number): void {
		this.lastPreMoveScore = score;
	}

	getPreMoveScore(): number {
		return this.lastPreMoveScore;
	}

	/** Get accumulated evals array (position 0 = start, position i = after move i). */
	getPositionEvals(): number[] {
		return this.positionEvals;
	}

	/** Send message to all players and spectators (public). */
	broadcastMessage(msg: unknown): void {
		this.broadcast(msg);
	}

	/** Is a specific user in this room? */
	hasUser(userId: string): boolean {
		return this.players.white?.userId === userId || this.players.black?.userId === userId;
	}

	/** Get room settings for rematch. */
	getSettings(): { gameType: GameType; timeControl: TimeControl; boardSize: number } {
		return { gameType: this.gameType, timeControl: this.timeControl, boardSize: this.boardSize };
	}

	/** Set metadata to include in MP_GAME_START (e.g., autoplay flag). */
	setStartMetadata(meta: Record<string, unknown>): void {
		this.startMetadata = meta;
	}

	/** Get the player MpClient for a given color. */
	getPlayer(color: "white" | "black"): MpClient | null {
		return this.players[color];
	}

	destroy(): void {
		this.clock?.destroy();
		for (const timer of this.disconnectTimers.values()) {
			clearTimeout(timer);
		}
	}

	// ── Private helpers ──

	private startGame(): void {
		this.status = "playing";
		const white = this.players.white!;
		const black = this.players.black!;

		log.info(`Game ${this.id} started: ${white.userId} vs ${black.userId} (${this.gameType})`);

		// Start clock if timed
		if (this.timeControl.initial > 0) {
			this.clock = new FischerClock(
				this.timeControl.initial,
				this.timeControl.increment,
				(side) => this.endGame(side === "white" ? "black" : "white", "timeout"),
				(state) => this.broadcast({ type: "CLOCK_UPDATE", ...state }),
			);
			this.clock.start("white"); // White moves first
		}

		// Send MP_GAME_START to both players
		console.log(`[mp] startGame: white=${white.userId}, black=${black.userId}`);
		console.log(`[mp] sending MP_GAME_START to white (${white.userId})`);
		white.send({
			type: "MP_GAME_START",
			gameId: this.id,
			gameType: this.gameType,
			yourColor: "white",
			opponentName: black.nickname || black.userId,
			timeControl: this.timeControl,
			...this.startMetadata,
		});
		console.log(`[mp] sending MP_GAME_START to black (${black.userId})`);
		black.send({
			type: "MP_GAME_START",
			gameId: this.id,
			gameType: this.gameType,
			yourColor: "black",
			opponentName: white.nickname || white.userId,
			timeControl: this.timeControl,
			...this.startMetadata,
		});

		// Send initial game state to both
		white.send(this.buildGameState("white"));
		black.send(this.buildGameState("black"));
	}

	private endGame(winner: "white" | "black" | "draw", reason: string): void {
		this.status = "finished";
		this.clock?.pause();

		const result = { winner, reason };
		this.broadcast({ type: "GAME_OVER", result });
		log.info(`Game ${this.id} ended: ${winner} by ${reason}`);

		// Trigger post-game evaluation
		if (this.onGameEndCallback) {
			try {
				this.onGameEndCallback(this);
			} catch {}
		}
	}

	private getCurrentTurn(): "white" | "black" {
		return this.game.turn;
	}

	private isGameOver(): boolean {
		return this.game.isGameOver;
	}

	getResult(): { winner: "white" | "black" | "draw"; reason: string } {
		if (this.game instanceof GoGame) {
			const goResult = this.game.getGameResult();
			// Resignation — use as-is
			if (goResult && goResult.reason === "resignation") return goResult;
			// Score: territory + stones + prisoners + komi
			const score = this.game.getScore();
			const blackScore = score.black;
			const whiteScore = score.white + 7.5; // komi
			if (blackScore > whiteScore)
				return { winner: "black", reason: `B+${(blackScore - whiteScore).toFixed(1)}` };
			if (whiteScore > blackScore)
				return { winner: "white", reason: `W+${(whiteScore - blackScore).toFixed(1)}` };
			return { winner: "draw", reason: "Jigo" };
		}
		if (this.game instanceof ChessGame || this.game instanceof JanggiGame) {
			if (this.game.isCheckmate) {
				return { winner: this.game.turn === "white" ? "black" : "white", reason: "checkmate" };
			}
			if (this.game instanceof ChessGame) {
				if (this.game.isStalemate) return { winner: "draw", reason: "stalemate" };
				if (this.game.isDraw) return { winner: "draw", reason: "draw" };
			}
		}
		return { winner: "draw", reason: "unknown" };
	}

	getPlayerColor(client: MpClient): "white" | "black" | null {
		if (this.players.white?.userId === client.userId) return "white";
		if (this.players.black?.userId === client.userId) return "black";
		return null;
	}

	private findPlayerSlot(userId: string): "white" | "black" | null {
		if (this.players.white?.userId === userId) return "white";
		if (this.players.black?.userId === userId) return "black";
		return null;
	}

	private buildGameState(perspective: "white" | "black"): Record<string, unknown> {
		const base: Record<string, unknown> = {
			type: "GAME_STATE",
			gameId: this.id,
			gameType: this.gameType,
			playerColor: perspective,
			turn: this.getCurrentTurn(),
			moveHistory: [],
			capturedPieces: { white: [], black: [] },
			isCheck: false,
			isGameOver: this.isGameOver(),
			difficulty: "multiplayer",
		};

		if (this.game instanceof GoGame) {
			base.fen = "";
			base.boardState = this.game.getBoardState();
			base.boardSize = this.boardSize;
			base.prisoners = this.game.prisoners;
			base.legalMoves = {};
		} else {
			base.fen = this.game.fen;
			base.legalMoves =
				this.getCurrentTurn() === perspective ? this.game.getLegalMovesObject() : {};
			if (this.game instanceof ChessGame) {
				base.isCheck = this.game.isCheck;
				base.capturedPieces = this.game.getCapturedPieces();
			} else if (this.game instanceof JanggiGame) {
				const cp = this.game.getCapturedPieces();
				base.capturedPieces = { white: cp.blue, black: cp.red };
			}
		}

		return base;
	}

	private buildMovePayload(move: string): Record<string, unknown> {
		const base: Record<string, unknown> = {
			type: "MOVE",
			move: { san: move, uci: move, fen: "", moveNumber: 0 },
			turn: this.getCurrentTurn(),
			legalMoves: {},
			capturedPieces: { white: [], black: [] },
			isCheck: false,
			isGameOver: this.isGameOver(),
		};

		if (this.game instanceof GoGame) {
			base.boardState = this.game.getBoardState();
			base.prisoners = this.game.prisoners;
		} else if (this.game instanceof ChessGame || this.game instanceof JanggiGame) {
			const lastMove = this.game.getMoveHistory()?.[this.game.getMoveHistory().length - 1];
			if (lastMove) {
				base.move = lastMove;
			}
			base.legalMoves = this.game.getLegalMovesObject();
			if (this.game instanceof ChessGame) {
				base.isCheck = this.game.isCheck;
				base.capturedPieces = this.game.getCapturedPieces();
			} else {
				const cp = this.game.getCapturedPieces();
				base.capturedPieces = { white: cp.blue, black: cp.red };
			}
			(base.move as Record<string, unknown>).fen = this.game.fen;
		}

		if (this.isGameOver()) {
			base.result = this.getResult();
		}

		return base;
	}

	/** Send message to all players and spectators. */
	private broadcast(msg: unknown): void {
		for (const p of [this.players.white, this.players.black]) {
			if (p)
				try {
					p.send(msg);
				} catch {
					/* disconnected */
				}
		}
		for (const s of this.spectators) {
			try {
				s.send(msg);
			} catch {
				/* disconnected */
			}
		}
	}

	private broadcastSpectatorCount(): void {
		this.broadcast({ type: "SPECTATOR_COUNT", count: this.spectators.size });
	}
}
