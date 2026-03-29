#!/usr/bin/env node
/**
 * MP Autoplay Test — runs two autoplay clients at different Elo settings,
 * plays a full game, and logs results.
 *
 * Usage: node test-mp-autoplay.js [gameType] [blueElo] [redElo]
 * Example: node test-mp-autoplay.js janggi 800 2200
 */
const WebSocket = require('./node_modules/.pnpm/ws@8.20.0/node_modules/ws');
const fs = require('fs');

const gameType = process.argv[2] || 'janggi';
const blueElo = parseInt(process.argv[3] || '800', 10);
const redElo = parseInt(process.argv[4] || '2200', 10);
const MAX_MOVES = 200;
const TIMEOUT_MS = 120_000;

const logFile = `test-mp-${gameType}-${blueElo}v${redElo}-${Date.now()}.log`;
const logLines = [];

function log(tag, ...args) {
	const line = `[${tag}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
	logLines.push(line);
	console.log(line);
}

function createClient(name, elo) {
	const ws = new WebSocket('ws://localhost:8082/game-ws');
	const state = {
		name, elo, ws,
		gameStarted: false,
		moveCount: 0,
		autoplayActive: false,
		isGameOver: false,
		skillEval: null,
		gameSummary: null,
		moveQualities: [],
		lastSuggestions: null,
	};

	ws.on('error', err => log(name, 'ERROR:', err.message));
	ws.on('close', () => log(name, 'disconnected'));

	ws.on('message', raw => {
		const m = JSON.parse(raw.toString());

		switch (m.type) {
			case 'GAME_STATE':
				// Only respond to MP game states (after MP_GAME_START sets mpGameId)
				if (state.mpGameId && m.gameId === state.mpGameId && !state.gameStarted) {
					state.gameStarted = true;
					log(name, `game started, color=${state.playerColor}, turn=${m.turn}`);
					state.turn = m.turn;
					if (m.turn === state.playerColor) {
						ws.send(JSON.stringify({ type: 'REQUEST_ANALYSIS' }));
					}
				}
				break;

			case 'MP_GAME_START':
				log(name, `MP_GAME_START: color=${m.yourColor} vs ${m.opponentName}`);
				state.playerColor = m.yourColor;
				state.mpGameId = m.gameId;
				state.gameStarted = false; // reset for rematch
				break;

			case 'MOVE':
				state.moveCount = m.move?.moveNumber || state.moveCount + 1;
				state.turn = m.turn;
				if (!m.isGameOver && m.turn === state.playerColor) {
					ws.send(JSON.stringify({ type: 'REQUEST_ANALYSIS' }));
				}
				break;

			case 'SUGGESTIONS':
				state.lastSuggestions = m.suggestions;
				if (state.isGameOver) break;
				if (state.turn !== state.playerColor) break;
				if (!m.suggestions || m.suggestions.length === 0) break;

				// Pick move based on weakMove or best
				const chosenMove = m.weakMove || m.suggestions[0].move;
				const bestMove = m.suggestions[0].move;
				const bestScore = m.suggestions[0].score;

				if (chosenMove !== bestMove) {
					log(name, `move ${state.moveCount}: playing WEAK ${chosenMove} (best was ${bestMove} @${bestScore})`);
				}

				// Repetition detection
				if (!state.recentMoves) state.recentMoves = [];
				state.recentMoves.push(chosenMove);
				if (state.recentMoves.length > 4) state.recentMoves.shift();
				const repeatCount = state.recentMoves.filter(m => m === chosenMove).length;
				if (repeatCount >= 2 && state.moveCount > 20) {
					log(name, `REPETITION detected at move ${state.moveCount}, resigning`);
					ws.send(JSON.stringify({ type: 'RESIGN' }));
					break;
				}

				setTimeout(() => {
					if (state.isGameOver) return;
					if (chosenMove.toUpperCase() === 'PASS') {
						ws.send(JSON.stringify({ type: 'PASS' }));
					} else {
						ws.send(JSON.stringify({ type: 'PLAY_MOVE', move: chosenMove }));
					}
				}, 100);
				break;

			case 'MOVE_QUALITY':
				// Only count this quality if it was for a move we played
				// (MOVE_QUALITY is broadcast, but we track whose move it was by turn)
				state.moveQualities.push({ move: m.move, quality: m.quality });
				break;

			case 'GAME_OVER':
				state.isGameOver = true;
				log(name, `GAME_OVER: winner=${m.result.winner} reason=${m.result.reason}`);
				break;

			case 'SKILL_EVAL':
				state.skillEval = m;
				log(name, `SKILL_EVAL: accuracy=${m.accuracy}% acpl=${m.acpl} skill=${m.skill?.label} (${m.skill?.rating})`);
				break;

			case 'GAME_SUMMARY':
				state.gameSummary = m.text?.substring(0, 100);
				log(name, `GAME_SUMMARY received (${m.text?.length} chars)`);
				break;

			case 'ERROR':
				log(name, `SERVER ERROR: ${m.message}`);
				break;
		}
	});

	return state;
}

async function run() {
	log('TEST', `Starting MP autoplay test: ${gameType} Blue(${blueElo}) vs Red(${redElo})`);

	const blue = createClient('BLUE', blueElo);
	const red = createClient('RED', redElo);

	// Wait for connections
	await Promise.all([
		new Promise(r => blue.ws.on('open', r)),
		new Promise(r => red.ws.on('open', r)),
	]);

	// Setup blue (creator)
	blue.ws.send(JSON.stringify({ type: 'SET_NICKNAME', nickname: 'Blue800' }));
	blue.ws.send(JSON.stringify({ type: 'NEW_GAME', gameType: 'chess', difficulty: 'casual', playerColor: 'white' }));
	blue.ws.send(JSON.stringify({ type: 'AUTOPLAY', enabled: true, humanElo: blueElo }));

	// Setup red (acceptor)
	red.ws.send(JSON.stringify({ type: 'SET_NICKNAME', nickname: 'Red2200' }));
	red.ws.send(JSON.stringify({ type: 'NEW_GAME', gameType: 'chess', difficulty: 'casual', playerColor: 'white' }));
	red.ws.send(JSON.stringify({ type: 'AUTOPLAY', enabled: true, humanElo: redElo }));

	// Blue creates challenge
	await new Promise(r => setTimeout(r, 500));
	blue.ws.send(JSON.stringify({ type: 'CREATE_CHALLENGE', gameType, timeControl: { initial: 0, increment: 0 } }));

	// Red accepts
	await new Promise(r => setTimeout(r, 500));
	red.ws.send(JSON.stringify({ type: 'REQUEST_LOBBY' }));

	// Wait for lobby state with challenge, then accept
	await new Promise((resolve) => {
		const handler = (raw) => {
			const m = JSON.parse(raw.toString());
			if (m.type === 'LOBBY_STATE' && m.challenges?.length > 0) {
				red.ws.removeListener('message', handler);
				red.ws.send(JSON.stringify({ type: 'ACCEPT_CHALLENGE', challengeId: m.challenges[0].id }));
				resolve();
			}
		};
		red.ws.on('message', handler);
	});

	log('TEST', 'Challenge accepted, game starting...');

	// Wait for game to finish or timeout
	const startTime = Date.now();
	await new Promise((resolve) => {
		const check = setInterval(() => {
			const elapsed = Date.now() - startTime;
			if (blue.isGameOver || red.isGameOver) {
				clearInterval(check);
				resolve();
			} else if (elapsed > TIMEOUT_MS) {
				log('TEST', 'TIMEOUT — resigning blue to end game');
				blue.ws.send(JSON.stringify({ type: 'RESIGN' }));
				// Wait a bit for GAME_OVER to arrive
				setTimeout(() => { clearInterval(check); resolve(); }, 2000);
			}
			// Safety: resign if too many moves
			if (blue.moveCount > MAX_MOVES && !blue.isGameOver) {
				log('TEST', `Max moves (${MAX_MOVES}) reached, resigning blue`);
				blue.ws.send(JSON.stringify({ type: 'RESIGN' }));
			}
		}, 500);
	});

	// Wait for SKILL_EVAL (up to 10s)
	log('TEST', 'Waiting for SKILL_EVAL...');
	const evalStart = Date.now();
	await new Promise((resolve) => {
		const check = setInterval(() => {
			if ((blue.skillEval && red.skillEval) || Date.now() - evalStart > 10000) {
				clearInterval(check);
				resolve();
			}
		}, 500);
	});

	// Summary
	log('TEST', '=== RESULTS ===');
	log('TEST', `Game: ${gameType}, Moves: ${Math.max(blue.moveCount, red.moveCount)}`);

	const blueQualities = {};
	blue.moveQualities.forEach(mq => { blueQualities[mq.quality] = (blueQualities[mq.quality] || 0) + 1; });
	const redQualities = {};
	red.moveQualities.forEach(mq => { redQualities[mq.quality] = (redQualities[mq.quality] || 0) + 1; });

	log('TEST', `Blue (${blueElo} Elo):`);
	log('TEST', `  Accuracy: ${blue.skillEval?.accuracy ?? '?'}%  ACPL: ${blue.skillEval?.acpl ?? '?'}  Skill: ${blue.skillEval?.skill?.label ?? '?'} (${blue.skillEval?.skill?.rating ?? '?'})`);
	log('TEST', `  Move qualities: ${JSON.stringify(blueQualities)}`);

	log('TEST', `Red (${redElo} Elo):`);
	log('TEST', `  Accuracy: ${red.skillEval?.accuracy ?? '?'}%  ACPL: ${red.skillEval?.acpl ?? '?'}  Skill: ${red.skillEval?.skill?.label ?? '?'} (${red.skillEval?.skill?.rating ?? '?'})`);
	log('TEST', `  Move qualities: ${JSON.stringify(redQualities)}`);

	if (blue.skillEval && red.skillEval) {
		const gap = Math.abs(blue.skillEval.accuracy - red.skillEval.accuracy);
		log('TEST', `Accuracy gap: ${gap}pp ${gap < 10 ? '⚠️ TOO SMALL' : gap < 20 ? '⚠️ MARGINAL' : '✅ GOOD'}`);
	}

	// Write log file
	fs.writeFileSync(logFile, logLines.join('\n') + '\n');
	log('TEST', `Log saved to ${logFile}`);

	blue.ws.close();
	red.ws.close();
	process.exit(0);
}

run().catch(err => {
	console.error('Test failed:', err);
	process.exit(1);
});
