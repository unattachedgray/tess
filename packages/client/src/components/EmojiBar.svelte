<script lang="ts">
	let { onEmoji }: { onEmoji: (emoji: string) => void } = $props();

	const EMOJIS = ["\u{1F44D}", "\u{1F44F}", "\u{1F605}", "\u{1F914}", "\u{26A1}", "\u{1F91D}"];

	let lastSent = $state<string | null>(null);

	function send(emoji: string) {
		onEmoji(emoji);
		lastSent = emoji;
		setTimeout(() => lastSent = null, 1500);
	}
</script>

<div class="emoji-bar">
	{#each EMOJIS as emoji}
		<button
			class="emoji-btn"
			class:sent={lastSent === emoji}
			onclick={() => send(emoji)}
			title="Send reaction"
		>
			{emoji}
		</button>
	{/each}
</div>

<style>
	.emoji-bar {
		display: flex;
		gap: 4px;
		justify-content: center;
		padding: 4px;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
	}

	.emoji-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		font-size: 18px;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.emoji-btn:hover {
		background: var(--bg-hover);
		transform: scale(1.2);
	}

	.emoji-btn.sent {
		animation: emoji-pop 0.3s ease;
	}

	@keyframes emoji-pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.4); }
		100% { transform: scale(1); }
	}
</style>
