<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { t } from "../lib/i18n.ts";
	import DifficultyPicker from "../components/DifficultyPicker.svelte";
	import type { WsClient } from "../lib/ws.ts";
	import { getDifficultyRating } from "@tess/shared";
	import type { DifficultyId, GameType } from "@tess/shared";

	let { ws, onStart, compact = false }: { ws: WsClient; onStart?: () => void; compact?: boolean } = $props();

	let boardSize = $state(19);

	const gameLabel = (g: GameType) => t(`game.${g}`, appState.language);

	// Derive difficulty descriptions from shared SKILL_SCALE (single source of truth)
	const DIFFICULTY_IDS: DifficultyId[] = ["beginner", "casual", "club", "pro", "superhuman"];
	const DIFFICULTY_LABEL: Record<DifficultyId, string> = {
		beginner: "Beginner", casual: "Casual", club: "Club", pro: "Pro", superhuman: "Superhuman",
	};

	function buildDifficulties(game: GameType): { id: DifficultyId; label: string; description: string }[] {
		return DIFFICULTY_IDS.map(id => ({
			id,
			label: DIFFICULTY_LABEL[id],
			description: `~${getDifficultyRating(id, game)}`,
		}));
	}

	const DIFFICULTIES: Record<GameType, { id: DifficultyId; label: string; description: string }[]> = {
		chess: buildDifficulties("chess"),
		go: buildDifficulties("go"),
		janggi: buildDifficulties("janggi"),
	};

	const COLOR_LABELS = $derived.by(() => {
		const _lang = appState.language;
		if (appState.gameType === "janggi") return { white: t("color.blue", _lang), black: t("color.red", _lang) };
		return { white: t("color.white", _lang), black: t("color.black", _lang) };
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
				<p class="text-[var(--text-secondary)]">{t("home.tagline", appState.language)}</p>
			</div>
		{/if}

		<!-- Game Type -->
		<div class="space-y-3">
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">{t("menu.game", appState.language)}</h2>
			<div class="grid grid-cols-3 gap-2">
				{#each (["chess", "go", "janggi"] as GameType[]) as game}
					<button
						class="px-4 py-3 rounded-xl text-sm font-medium transition-all {appState.gameType === game
							? 'bg-[var(--accent)] text-[var(--bg-primary)]'
							: 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
						onclick={() => selectGame(game)}
					>
						{gameLabel(game)}
					</button>
				{/each}
			</div>
		</div>

		<!-- Board Size (Go only) -->
		{#if appState.gameType === 'go'}
			<div class="space-y-3">
				<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">{t("menu.boardSize", appState.language)}</h2>
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
			<h2 class="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">{t("menu.playAs", appState.language)}</h2>
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
			{t("menu.play", appState.language)} {gameLabel(appState.gameType)}
		</button>
	</div>
</div>
