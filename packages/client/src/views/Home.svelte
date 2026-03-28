<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import DifficultyPicker from "../components/DifficultyPicker.svelte";
	import type { WsClient } from "../lib/ws.ts";
	import type { DifficultyId } from "@tess/shared";

	let { ws }: { ws: WsClient } = $props();

	const difficulties: { id: DifficultyId; label: string; description: string }[] = [
		{ id: "beginner", label: "Beginner", description: "~1000 Elo" },
		{ id: "casual", label: "Casual", description: "~1500 Elo" },
		{ id: "club", label: "Club", description: "~2000 Elo" },
		{ id: "pro", label: "Pro", description: "~2500 Elo" },
		{ id: "superhuman", label: "Superhuman", description: "~2800+ Elo" },
	];

	function startGame() {
		ws.on("GAME_STATE", (msg) => {
			appState.updateFromGameState(msg);
			appState.view = "game";
		});

		ws.on("MOVE", (msg) => {
			appState.updateFromMove(msg);
		});

		ws.on("GAME_OVER", (msg) => {
			appState.isGameOver = true;
			appState.result = msg.result;
		});

		ws.send({
			type: "NEW_GAME",
			gameType: appState.gameType,
			difficulty: appState.difficulty,
			playerColor: appState.playerColor,
		});
	}
</script>

<div class="flex flex-col items-center justify-center min-h-[calc(100vh-57px)] px-4">
	<div class="w-full max-w-md space-y-8">
		<div class="text-center space-y-2">
			<h1 class="text-4xl font-bold text-[var(--accent)]">Tess</h1>
			<p class="text-[var(--text-secondary)]">Play board games against AI</p>
		</div>

		<!-- Game Type (Chess only for Phase 1) -->
		<div class="space-y-3">
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Game</h2>
			<div class="grid grid-cols-3 gap-2">
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all bg-[var(--accent)] text-[var(--bg-primary)]"
				>
					Chess
				</button>
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed opacity-50"
					disabled
				>
					Go
				</button>
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all bg-[var(--bg-secondary)] text-[var(--text-muted)] cursor-not-allowed opacity-50"
					disabled
				>
					Janggi
				</button>
			</div>
		</div>

		<!-- Color -->
		<div class="space-y-3">
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Play as</h2>
			<div class="grid grid-cols-2 gap-2">
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.playerColor === 'white'
						? 'bg-white text-gray-900 shadow-lg'
						: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
					onclick={() => appState.playerColor = 'white'}
				>
					White
				</button>
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.playerColor === 'black'
						? 'bg-gray-800 text-white shadow-lg border border-[var(--border)]'
						: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
					onclick={() => appState.playerColor = 'black'}
				>
					Black
				</button>
			</div>
		</div>

		<!-- Difficulty -->
		<DifficultyPicker {difficulties} />

		<!-- Play Button -->
		<button
			class="w-full py-4 rounded-xl text-lg font-semibold bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors shadow-lg"
			onclick={startGame}
		>
			Play Chess
		</button>
	</div>
</div>
