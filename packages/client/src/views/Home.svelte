<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import DifficultyPicker from "../components/DifficultyPicker.svelte";
	import type { WsClient } from "../lib/ws.ts";
	import type { DifficultyId, GameType } from "@tess/shared";

	let { ws, onStart, compact = false }: { ws: WsClient; onStart?: () => void; compact?: boolean } = $props();

	let boardSize = $state(19);

	const GAME_LABELS: Record<GameType, string> = {
		chess: "Chess",
		go: "Go",
		janggi: "Janggi",
	};

	const DIFFICULTIES: Record<GameType, { id: DifficultyId; label: string; description: string }[]> = {
		chess: [
			{ id: "beginner", label: "Beginner", description: "~1000 Elo" },
			{ id: "casual", label: "Casual", description: "~1500 Elo" },
			{ id: "club", label: "Club", description: "~2000 Elo" },
			{ id: "pro", label: "Pro", description: "~2500 Elo" },
			{ id: "superhuman", label: "Superhuman", description: "~2800+ Elo" },
		],
		go: [
			{ id: "beginner", label: "Beginner", description: "~20 kyu" },
			{ id: "casual", label: "Casual", description: "~8 kyu" },
			{ id: "club", label: "Club", description: "~3 dan" },
			{ id: "pro", label: "Pro", description: "~9 dan" },
			{ id: "superhuman", label: "Superhuman", description: "Superhuman" },
		],
		janggi: [
			{ id: "beginner", label: "Beginner", description: "~9급" },
			{ id: "casual", label: "Casual", description: "~5급" },
			{ id: "club", label: "Club", description: "~2단" },
			{ id: "pro", label: "Pro", description: "~5단" },
			{ id: "superhuman", label: "Superhuman", description: "~7단+" },
		],
	};

	const COLOR_LABELS = $derived.by(() => {
		if (appState.gameType === "go") return { white: "White", black: "Black" };
		if (appState.gameType === "janggi") return { white: "Blue (Cho)", black: "Red (Han)" };
		return { white: "White", black: "Black" };
	});

	function selectGame(game: GameType) {
		appState.setGameType(game);
		if (game === "go") appState.setPlayerColor("black");
		else appState.setPlayerColor("white");
	}

	function startGame() {
		if (appState.gameType === "go") appState.setBoardSize(boardSize);
		onStart?.();
	}
</script>

<div class={compact ? '' : 'flex flex-col items-center justify-center min-h-[calc(100vh-57px)] px-4'}>
	<div class="w-full max-w-md {compact ? 'space-y-5' : 'space-y-8'}">
		{#if !compact}
			<div class="text-center space-y-2">
				<h1 class="text-4xl font-bold text-[var(--accent)]">Tess</h1>
				<p class="text-[var(--text-secondary)]">Play board games against AI</p>
			</div>
		{/if}

		<!-- Game Type -->
		<div class="space-y-3">
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Game</h2>
			<div class="grid grid-cols-3 gap-2">
				{#each (["chess", "go", "janggi"] as GameType[]) as game}
					<button
						class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.gameType === game
							? 'bg-[var(--accent)] text-[var(--bg-primary)]'
							: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
						onclick={() => selectGame(game)}
					>
						{GAME_LABELS[game]}
					</button>
				{/each}
			</div>
		</div>

		<!-- Board Size (Go only) -->
		{#if appState.gameType === 'go'}
			<div class="space-y-3">
				<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Board Size</h2>
				<div class="grid grid-cols-3 gap-2">
					{#each [9, 13, 19] as size}
						<button
							class="px-4 py-3 rounded-xl text-sm font-medium transition-all {boardSize === size
								? 'bg-[var(--accent-glow)] border border-[var(--accent)] text-[var(--accent)]'
								: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
							onclick={() => boardSize = size}
						>
							{size}×{size}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Color -->
		<div class="space-y-3">
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Play as</h2>
			<div class="grid grid-cols-2 gap-2">
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.playerColor === 'white'
						? 'bg-white text-gray-900 shadow-lg'
						: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
					onclick={() => appState.setPlayerColor('white')}
				>
					{COLOR_LABELS.white}
				</button>
				<button
					class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.playerColor === 'black'
						? 'bg-gray-800 text-white shadow-lg border border-[var(--border)]'
						: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
					onclick={() => appState.setPlayerColor('black')}
				>
					{COLOR_LABELS.black}
				</button>
			</div>
		</div>

		<!-- Difficulty -->
		<DifficultyPicker difficulties={DIFFICULTIES[appState.gameType]} />

		<!-- Play Button -->
		<button
			class="w-full py-4 rounded-xl text-lg font-semibold bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] transition-colors shadow-lg"
			onclick={startGame}
		>
			Play {GAME_LABELS[appState.gameType]}
		</button>
	</div>
</div>
