<script lang="ts">
	import { appState } from "../lib/stores.svelte.ts";
	import { t } from "../lib/i18n.ts";
	import { PRESET_EMOJIS, PRESET_MESSAGES } from "@tess/shared";
	import type { WsClient } from "../lib/ws.ts";

	let { ws }: { ws: WsClient } = $props();

	let lastSent = $state<string | null>(null);
	let showPicker = $state(false);

	function sendEmoji(emoji: string) {
		ws.send({ type: "EMOJI_REACTION", emoji });
		appState.chatHistory = [...appState.chatHistory, { text: emoji, from: "You", isEmoji: true, ts: Date.now() }];
		lastSent = emoji;
		setTimeout(() => lastSent = null, 1500);
	}

	/** Send i18n key over the wire — receiver translates in their language. */
	function sendMessage(key: string) {
		ws.send({ type: "PRESET_MESSAGE", message: key });
		appState.chatHistory = [...appState.chatHistory, { text: t(key, appState.language), from: "You", isEmoji: false, ts: Date.now() }];
		lastSent = key;
		showPicker = false;
		setTimeout(() => lastSent = null, 1500);
	}

	// Recent chat (last 5)
	const recentChat = $derived(appState.chatHistory.slice(-5));
</script>

<!-- Chat history -->
{#if recentChat.length > 0}
	<div class="chat-history">
		{#each recentChat as entry}
			<div class="chat-entry" class:is-you={entry.from === "You"} class:is-emoji={entry.isEmoji}>
				{#if entry.isEmoji}
					<span class="chat-emoji">{entry.text}</span>
				{:else}
					<span class="chat-from">{entry.from}</span>
					<span class="chat-text">{entry.text}</span>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<!-- Send controls -->
<div class="chat-controls">
	<div class="emoji-row">
		{#each PRESET_EMOJIS as emoji}
			<button
				class="emoji-btn"
				class:sent={lastSent === emoji}
				onclick={() => sendEmoji(emoji)}
				title="Send {emoji}"
			>
				{emoji}
			</button>
		{/each}
		<button
			class="msg-toggle"
			class:active={showPicker}
			onclick={() => showPicker = !showPicker}
			title="Quick messages"
		>
			<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
				<path d="M2 2h12v9H4l-2 2V2zm2 2v1h8V4H4zm0 2v1h6V6H4zm0 2v1h4V8H4z"/>
			</svg>
		</button>
	</div>

	{#if showPicker}
		<div class="message-picker">
			{#each PRESET_MESSAGES as key}
				<button
					class="msg-btn"
					class:sent={lastSent === key}
					onclick={() => sendMessage(key)}
				>
					{t(key, appState.language)}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.chat-history {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 100px;
		overflow-y: auto;
		padding: 4px 8px;
		border-radius: 8px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		font-size: 12px;
	}

	.chat-entry {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.chat-entry.is-you {
		justify-content: flex-end;
	}

	.chat-entry.is-emoji {
		font-size: 16px;
	}

	.chat-from {
		color: var(--text-muted);
		font-weight: 600;
		font-size: 11px;
	}

	.chat-text {
		color: var(--text-secondary);
	}

	.chat-entry.is-you .chat-text {
		color: var(--accent);
	}

	.chat-emoji {
		line-height: 1;
	}

	.chat-controls {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.emoji-row {
		display: flex;
		gap: 2px;
		justify-content: center;
		align-items: center;
		padding: 3px;
		border-radius: 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
	}

	.emoji-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		font-size: 16px;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.emoji-btn:hover {
		background: var(--bg-hover);
		transform: scale(1.15);
	}

	.emoji-btn.sent {
		animation: pop 0.3s ease;
	}

	.msg-toggle {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--text-muted);
		transition: all 0.15s;
	}

	.msg-toggle:hover, .msg-toggle.active {
		background: var(--bg-hover);
		color: var(--accent);
	}

	.message-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 6px;
		border-radius: 10px;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		animation: slide-down 0.15s ease-out;
	}

	@keyframes slide-down {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.msg-btn {
		padding: 4px 10px;
		border-radius: 8px;
		font-size: 11px;
		font-weight: 500;
		background: var(--bg-hover);
		border: 1px solid var(--border);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.msg-btn:hover {
		background: var(--accent);
		color: var(--bg-primary);
		border-color: var(--accent);
	}

	.msg-btn.sent {
		animation: pop 0.3s ease;
	}

	@keyframes pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.15); }
		100% { transform: scale(1); }
	}
</style>
