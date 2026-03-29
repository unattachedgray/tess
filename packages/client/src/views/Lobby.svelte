<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { t } from "../lib/i18n.ts";
	import type { WsClient } from "../lib/ws.ts";
	import { TIME_PRESETS, type Challenge } from "@tess/shared";

	let { ws }: { ws: WsClient } = $props();

	let challenges = $state<Challenge[]>([]);
	let activePlayers = $state(0);
	let joinCode = $state("");
	let myChallenge = $state<string | null>(null);

	// Creation form state
	let showCreate = $state(false);
	let createGameType = $state<"chess" | "go" | "janggi">(
		(localStorage.getItem("mp-gameType") as "chess" | "go" | "janggi") ?? "chess"
	);
	let createTimeIdx = $state(
		Number(localStorage.getItem("mp-timeIdx") ?? "2")
	);
	let createColor = $state<"white" | "black" | undefined>(
		(localStorage.getItem("mp-color") as "white" | "black" | undefined) ?? undefined
	);

	// Subscribe to lobby on mount
	$effect(() => {
		ws.send({ type: "REQUEST_LOBBY" });
		ws.on("CHALLENGE_CREATED", (msg: any) => {
			myChallenge = msg.challengeId;
		});
		return () => {
			ws.send({ type: "LEAVE_LOBBY" });
			ws.off("CHALLENGE_CREATED");
		};
	});

	// Read lobby state from appState (populated by App.svelte's global handler)
	const storeChalls = $derived(appState.challenges);
	const storePlayers = $derived(appState.lobbyPlayerCount);
	$effect(() => {
		challenges = storeChalls;
		// Clear myChallenge if it was accepted/removed
		if (myChallenge && !storeChalls.some((c: any) => c.id === myChallenge)) {
			myChallenge = null;
		}
	});
	$effect(() => { activePlayers = storePlayers; });

	// Filter out own challenge — creator sees it in the waiting UI, not in the list
	const otherChallenges = $derived(challenges);

	function createChallenge() {
		// Remember settings for next time
		localStorage.setItem("mp-gameType", createGameType);
		localStorage.setItem("mp-timeIdx", String(createTimeIdx));
		if (createColor) localStorage.setItem("mp-color", createColor);
		else localStorage.removeItem("mp-color");
		const preset = TIME_PRESETS[createTimeIdx];
		ws.send({
			type: "CREATE_CHALLENGE",
			gameType: createGameType,
			timeControl: { initial: preset.initial, increment: preset.increment },
			color: createColor,
		});
		showCreate = false;
	}

	function cancelChallenge() {
		if (myChallenge) {
			ws.send({ type: "CANCEL_CHALLENGE", challengeId: myChallenge });
			myChallenge = null;
		}
	}

	function acceptChallenge(id: string) {
		ws.send({ type: "ACCEPT_CHALLENGE", challengeId: id });
	}

	function joinByCode() {
		if (joinCode.length === 6) {
			ws.send({ type: "JOIN_BY_CODE", code: joinCode.toUpperCase() });
		}
	}

	function goBack() {
		appState.view = "game";
	}

	function formatTime(tc: { initial: number; increment: number }): string {
		if (tc.initial === 0 && tc.increment === 0) return "No limit";
		const mins = Math.floor(tc.initial / 60);
		return tc.increment > 0 ? `${mins}+${tc.increment}` : `${mins}+0`;
	}

	const GAME_ICONS: Record<string, string> = { chess: "\u265A", go: "\u25CF", janggi: "\u5C07" };
</script>

<div class="lobby">
	<div class="lobby-header">
		<button class="back-btn" onclick={goBack}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8L10 13"/></svg>
			Back
		</button>
		<h1 class="lobby-title">Multiplayer</h1>
		<span class="player-count">{activePlayers} in lobby</span>
	</div>

	<!-- Join by code -->
	<div class="join-code-section">
		<input
			type="text"
			class="code-input"
			placeholder="Enter game code"
			maxlength="6"
			bind:value={joinCode}
			oninput={(e) => joinCode = (e.target as HTMLInputElement).value.toUpperCase()}
			onkeydown={(e) => { if (e.key === "Enter") joinByCode(); }}
		/>
		<button class="join-btn" onclick={joinByCode} disabled={joinCode.length !== 6}>Join</button>
	</div>

	<!-- Create challenge -->
	{#if myChallenge}
		<div class="my-challenge">
			<span class="waiting-text">
				<span class="waiting-dot"></span>
				Waiting for opponent...
			</span>
			<button class="cancel-btn" onclick={cancelChallenge}>Cancel</button>
		</div>
	{:else if showCreate}
		<div class="create-form">
			<div class="form-row">
				<span class="form-label">Game</span>
				<div class="form-options">
					{#each ["chess", "go", "janggi"] as g}
						<button
							class="option-btn"
							class:active={createGameType === g}
							onclick={() => createGameType = g as "chess" | "go" | "janggi"}
						>{g}</button>
					{/each}
				</div>
			</div>
			<div class="form-row">
				<span class="form-label">Time</span>
				<div class="form-options">
					{#each TIME_PRESETS as preset, i}
						<button
							class="option-btn"
							class:active={createTimeIdx === i}
							onclick={() => createTimeIdx = i}
						>{preset.label}</button>
					{/each}
				</div>
			</div>
			<div class="form-row">
				<span class="form-label">Color</span>
				<div class="form-options">
					<button class="option-btn" class:active={!createColor} onclick={() => createColor = undefined}>Random</button>
					<button class="option-btn" class:active={createColor === "white"} onclick={() => createColor = "white"}>White</button>
					<button class="option-btn" class:active={createColor === "black"} onclick={() => createColor = "black"}>Black</button>
				</div>
			</div>
			<div class="form-actions">
				<button class="create-btn" onclick={createChallenge}>Create Challenge</button>
				<button class="cancel-btn" onclick={() => showCreate = false}>Cancel</button>
			</div>
		</div>
	{:else}
		<button class="create-challenge-btn" onclick={() => showCreate = true}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>
			Create Challenge
		</button>
	{/if}

	<!-- Challenge list -->
	<div class="challenge-list">
		{#if otherChallenges.length === 0}
			<div class="empty-state">
				<p class="empty-text">No open challenges</p>
				<p class="empty-hint">Create one or share a game code with a friend</p>
			</div>
		{:else}
			{#each otherChallenges as ch}
				<div class="challenge-card">
					<div class="challenge-info">
						<span class="game-icon">{GAME_ICONS[ch.gameType] ?? ""}</span>
						<div>
							<span class="challenge-game">{ch.gameType}</span>
							<span class="challenge-time">{formatTime(ch.timeControl)}</span>
						</div>
					</div>
					<span class="challenge-creator">{ch.creatorName}</span>
					{#if ch.id === myChallenge}
						<button class="cancel-btn" onclick={cancelChallenge}>Cancel</button>
					{:else}
						<button class="accept-btn" onclick={() => acceptChallenge(ch.id)}>Play</button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.lobby {
		max-width: 600px;
		margin: 0 auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.lobby-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: var(--text-secondary);
		background: none;
		border: none;
		cursor: pointer;
	}
	.back-btn:hover { color: var(--accent); }

	.lobby-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--accent);
	}

	.player-count {
		font-size: 11px;
		color: var(--text-muted);
	}

	.join-code-section {
		display: flex;
		gap: 8px;
	}

	.code-input {
		flex: 1;
		padding: 10px 14px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-family: "SF Mono", "Cascadia Mono", monospace;
		font-size: 16px;
		letter-spacing: 0.15em;
		text-transform: uppercase;
		text-align: center;
	}
	.code-input::placeholder {
		text-transform: none;
		letter-spacing: normal;
		color: var(--text-muted);
	}

	.join-btn, .accept-btn, .create-btn, .create-challenge-btn {
		padding: 10px 20px;
		border-radius: 12px;
		border: none;
		background: var(--accent);
		color: var(--bg-primary);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition: background 0.15s;
	}
	.join-btn:hover, .accept-btn:hover, .create-btn:hover { background: var(--accent-hover); }
	.join-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.create-challenge-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 14px;
	}

	.cancel-btn {
		padding: 8px 16px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		font-size: 13px;
		cursor: pointer;
	}

	.my-challenge {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px;
		border-radius: 12px;
		background: var(--accent-glow);
		border: 1px solid var(--accent);
	}

	.waiting-text {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--accent);
		font-weight: 600;
	}

	.waiting-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.create-form {
		padding: 1rem;
		border-radius: 14px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.form-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.form-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}

	.form-options {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.option-btn {
		padding: 6px 12px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: var(--bg-hover);
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		text-transform: capitalize;
	}
	.option-btn:hover { color: var(--text-primary); }
	.option-btn.active {
		background: var(--accent-glow);
		border-color: var(--accent);
		color: var(--accent);
	}

	.form-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}

	.challenge-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.empty-state {
		text-align: center;
		padding: 2rem 1rem;
	}
	.empty-text { color: var(--text-secondary); font-size: 14px; }
	.empty-hint { color: var(--text-muted); font-size: 12px; margin-top: 4px; }

	.challenge-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
	}

	.challenge-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}

	.game-icon { font-size: 20px; opacity: 0.7; }
	.challenge-game { font-size: 13px; font-weight: 600; color: var(--text-primary); text-transform: capitalize; }
	.challenge-time { font-size: 11px; color: var(--text-muted); margin-left: 6px; }
	.challenge-creator { font-size: 12px; color: var(--text-secondary); }
	.challenge-code {
		font-family: "SF Mono", "Cascadia Mono", monospace;
		font-size: 11px;
		color: var(--text-muted);
		padding: 2px 6px;
		background: var(--bg-hover);
		border-radius: 4px;
	}
</style>
