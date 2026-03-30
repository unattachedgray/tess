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
	let showCreate = $state(false); // kept for recent opponents quick-create
	let createGameType = $state<"chess" | "go" | "janggi">(
		(localStorage.getItem("mp-gameType") as "chess" | "go" | "janggi") ?? "chess"
	);
	let createTimeIdx = $state(
		Number(localStorage.getItem("mp-timeIdx") ?? "2")
	);
	let createColor = $state<"white" | "black" | undefined>(
		(localStorage.getItem("mp-color") as "white" | "black" | undefined) ?? undefined
	);

	let federationEnabled = $state(true);
	let federationStats = $state<{ dhtNodes: number; peersDiscovered: number; peersVerified: number; remotePlayers: number } | null>(null);

	async function fetchFederationStatus() {
		try {
			const res = await fetch("/api/federation/status");
			if (res.ok) {
				const data = await res.json();
				federationEnabled = data.enabled;
				federationStats = data.stats;
			}
		} catch {}
	}

	async function toggleFederation() {
		const newState = !federationEnabled;
		try {
			const res = await fetch("/api/federation/toggle", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: newState }),
			});
			if (res.ok) federationEnabled = newState;
		} catch {}
	}

	// Subscribe to lobby on mount
	$effect(() => {
		ws.send({ type: "REQUEST_LOBBY" });
		ws.on("CHALLENGE_CREATED", (msg: any) => {
			myChallenge = msg.challengeId;
		});
		fetchFederationStatus();
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

	const lang = $derived(appState.language);

	function formatTime(tc: { initial: number; increment: number }): string {
		if (tc.initial === 0 && tc.increment === 0) return "∞";
		const mins = Math.floor(tc.initial / 60);
		return tc.increment > 0 ? `${mins}+${tc.increment}` : `${mins}+0`;
	}

	const GAME_ICONS: Record<string, string> = { chess: "\u265A", go: "\u25CF", janggi: "\u5C07" };
</script>

<div class="lobby">
	<div class="lobby-header">
		<button class="back-btn" onclick={goBack}>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8L10 13"/></svg>
			{t("header.back", lang)}
		</button>
		<h1 class="lobby-title">{t("lobby.title", lang)}</h1>
		<div class="player-counts">
			<span class="player-count">
				<span class="count-dot local"></span>
				{activePlayers} {t("lobby.inLobby", lang)}
			</span>
			{#if appState.playerCounts.remotePlayers > 0}
				<span class="player-count remote">
					<span class="count-dot remote"></span>
					{appState.playerCounts.remotePlayers} remote ({appState.playerCounts.federatedServers} servers)
				</span>
			{/if}
		</div>
	</div>

	<!-- Create challenge (always visible) -->
	{#if myChallenge}
		<div class="my-challenge">
			<span class="waiting-text">
				<span class="waiting-dot"></span>
				{t("lobby.waiting", lang)}
			</span>
			<button class="cancel-btn" onclick={cancelChallenge}>{t("lobby.cancel", lang)}</button>
		</div>
	{:else}
		<div class="create-form">
			<div class="form-row">
				<span class="form-label">{t("lobby.gameLabel", lang)}</span>
				<div class="form-options">
					{#each ["chess", "go", "janggi"] as g}
						<button
							class="option-btn"
							class:active={createGameType === g}
							onclick={() => createGameType = g as "chess" | "go" | "janggi"}
						>{t(`game.${g}`, lang)}</button>
					{/each}
				</div>
			</div>
			<div class="form-row">
				<span class="form-label">{t("lobby.timeLabel", lang)}</span>
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
				<span class="form-label">{t("lobby.colorLabel", lang)}</span>
				<div class="form-options">
					<button class="option-btn" class:active={!createColor} onclick={() => createColor = undefined}>{t("lobby.random", lang)}</button>
					<button class="option-btn" class:active={createColor === "white"} onclick={() => createColor = "white"}>{t("color.white", lang)}</button>
					<button class="option-btn" class:active={createColor === "black"} onclick={() => createColor = "black"}>{t("color.black", lang)}</button>
				</div>
			</div>
			<button class="create-btn" onclick={createChallenge}>{t("lobby.create", lang)}</button>
		</div>
	{/if}

	<!-- Open challenges -->
	{#if otherChallenges.length > 0}
		<div class="challenge-list">
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
						<button class="cancel-btn" onclick={cancelChallenge}>{t("lobby.cancel", lang)}</button>
					{:else}
						<button class="accept-btn" onclick={() => acceptChallenge(ch.id)}>{t("menu.play", lang)}</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Recent Opponents -->
	{#if appState.recentOpponents.length > 0}
		<div class="recent-section">
			<h3 class="section-label">{t("lobby.recentPlayers", lang)}</h3>
			<div class="recent-list">
				{#each appState.recentOpponents as opp}
					<div class="recent-card">
						<div class="recent-info">
							<span class="recent-name">{opp.name}</span>
							<span class="recent-meta">
								{opp.gameType}
								{#if opp.result}
									<span class="recent-result {opp.result}">
										{opp.result === "win" ? "W" : opp.result === "loss" ? "L" : "D"}
									</span>
								{/if}
							</span>
						</div>
						<button
							class="accept-btn"
							onclick={() => {
								createGameType = (opp.gameType as "chess" | "go" | "janggi") ?? "chess";
								createChallenge();
							}}
						>{t("lobby.create", lang)}</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Join by code -->
	<div class="join-code-section">
		<input
			type="text"
			class="code-input"
			placeholder={t("lobby.enterCode", lang)}
			maxlength="6"
			bind:value={joinCode}
			oninput={(e) => joinCode = (e.target as HTMLInputElement).value.toUpperCase()}
			onkeydown={(e) => { if (e.key === "Enter") joinByCode(); }}
		/>
		<button class="join-btn" onclick={joinByCode} disabled={joinCode.length !== 6}>{t("lobby.join", lang)}</button>
	</div>

	<!-- Federation -->
	<div class="federation-section">
		<div class="federation-header">
			<span class="federation-label">{t("lobby.network", lang)}</span>
			<button
				class="toggle-btn {federationEnabled ? 'on' : 'off'}"
				onclick={toggleFederation}
				title={federationEnabled ? "Disable network discovery" : "Enable network discovery"}
			>
				<div class="toggle-knob"></div>
			</button>
		</div>
		{#if federationEnabled && appState.playerCounts.remotePlayers > 0}
			<div class="federation-stats">
				<span class="count-dot remote"></span>
				<span>{appState.playerCounts.remotePlayers} players on {appState.playerCounts.federatedServers} servers</span>
			</div>
		{:else if federationEnabled}
			<div class="federation-stats muted">
				<span>Searching for other Tess servers...</span>
			</div>
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

	.player-counts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}

	.player-count {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.player-count.remote {
		font-size: 10px;
		color: var(--accent);
		opacity: 0.8;
	}

	.count-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
	}

	.count-dot.local {
		background: var(--success);
	}

	.count-dot.remote {
		background: var(--accent);
	}

	.recent-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.section-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}

	.recent-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.recent-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
	}

	.recent-info {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.recent-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.recent-meta {
		font-size: 11px;
		color: var(--text-muted);
		text-transform: capitalize;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.recent-result {
		font-size: 10px;
		font-weight: 700;
		padding: 1px 5px;
		border-radius: 4px;
	}

	.recent-result.win { color: var(--success); background: color-mix(in srgb, var(--success) 15%, transparent); }
	.recent-result.loss { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
	.recent-result.draw { color: var(--text-muted); background: var(--bg-hover); }

	.federation-section {
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
	}

	.federation-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.federation-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}

	.toggle-btn {
		width: 36px;
		height: 20px;
		border-radius: 10px;
		border: none;
		cursor: pointer;
		position: relative;
		transition: background 0.2s;
	}

	.toggle-btn.on { background: var(--accent); }
	.toggle-btn.off { background: var(--bg-hover); }

	.toggle-knob {
		position: absolute;
		top: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: white;
		box-shadow: 0 1px 3px rgba(0,0,0,0.2);
		transition: transform 0.2s;
	}

	.toggle-btn.on .toggle-knob { transform: translateX(18px); }
	.toggle-btn.off .toggle-knob { transform: translateX(2px); }

	.federation-stats {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 11px;
		color: var(--accent);
	}

	.federation-stats.muted {
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
