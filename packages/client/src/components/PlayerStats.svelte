<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { t } from "../lib/i18n.ts";

	interface Stats {
		gamesPlayed: number;
		wins: number;
		losses: number;
		draws: number;
		avgAccuracy: number | null;
	}

	let stats = $state<Stats | null>(null);
	let loading = $state(false);
	let lastUserId = $state<string | null>(null);

	// Fetch stats when userId changes or game ends
	$effect(() => {
		const userId = appState.userId;
		const gameOver = appState.isGameOver;

		// Fetch on first load or when game ends
		if (userId && (userId !== lastUserId || gameOver)) {
			lastUserId = userId;
			fetchStats(userId);
		}
	});

	async function fetchStats(userId: string) {
		loading = true;
		try {
			const res = await fetch(`/api/users/${encodeURIComponent(userId)}/stats`);
			if (res.ok) {
				stats = await res.json();
			}
		} catch {
			// silently fail
		} finally {
			loading = false;
		}
	}

	const winRate = $derived(
		stats && stats.gamesPlayed > 0
			? Math.round((stats.wins / stats.gamesPlayed) * 100)
			: null
	);

	const streak = $derived(appState.currentWinStreak);
	const bestStreak = $derived(appState.longestWinStreak);
</script>

{#if stats && stats.gamesPlayed > 0}
	<div class="stats-bar">
		<div class="stat">
			<span class="stat-value">{stats.gamesPlayed}</span>
			<span class="stat-label">{t("stats.games", appState.language)}</span>
		</div>
		<div class="stat-divider"></div>
		<div class="stat">
			<span class="stat-value win">{stats.wins}</span>
			<span class="stat-label">{t("stats.w", appState.language)}</span>
		</div>
		<div class="stat">
			<span class="stat-value loss">{stats.losses}</span>
			<span class="stat-label">{t("stats.l", appState.language)}</span>
		</div>
		<div class="stat">
			<span class="stat-value draw">{stats.draws}</span>
			<span class="stat-label">{t("stats.d", appState.language)}</span>
		</div>
		<div class="stat-divider"></div>
		{#if winRate !== null}
			<div class="stat">
				<span class="stat-value" class:good={winRate >= 50} class:bad={winRate < 40}>{winRate}%</span>
				<span class="stat-label">{t("stats.win", appState.language)}</span>
			</div>
		{/if}
		{#if stats.avgAccuracy !== null}
			<div class="stat">
				<span class="stat-value accent">{stats.avgAccuracy}%</span>
				<span class="stat-label">{t("stats.acc", appState.language)}</span>
			</div>
		{/if}
		{#if streak > 0 || bestStreak > 0}
			<div class="stat-divider"></div>
			<div class="stat" title="Current / Best win streak">
				<span class="stat-value" class:good={streak >= 3}>{streak}</span>
				<span class="stat-label">{streak > 0 ? "🔥" : "—"}</span>
			</div>
		{/if}
	</div>
{:else if appState.currentWinStreak > 0}
	<div class="stats-bar">
		<div class="stat" title="Current win streak">
			<span class="stat-value good">{appState.currentWinStreak}🔥</span>
			<span class="stat-label">streak</span>
		</div>
	</div>
{/if}

<style>
	.stats-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 4px 12px;
		border-radius: 8px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		font-family: "SF Mono", "Cascadia Mono", monospace;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.stat-value {
		font-size: 13px;
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.2;
	}

	.stat-value.win { color: var(--success); }
	.stat-value.loss { color: var(--danger); }
	.stat-value.draw { color: var(--text-muted); }
	.stat-value.good { color: var(--success); }
	.stat-value.bad { color: var(--danger); }
	.stat-value.accent { color: var(--accent); }

	.stat-label {
		font-size: 9px;
		font-weight: 500;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.stat-divider {
		width: 1px;
		height: 20px;
		background: var(--border);
	}
</style>
