import { appState } from "./stores.svelte.ts";

const audioCache = new Map<string, HTMLAudioElement>();

function getAudio(name: string): HTMLAudioElement {
	let audio = audioCache.get(name);
	if (!audio) {
		audio = new Audio(`/sounds/${name}.mp3`);
		audioCache.set(name, audio);
	}
	return audio;
}

export function playSound(type: "move" | "capture" | "check" | "gameEnd"): void {
	if (!appState.soundEnabled) return;
	try {
		const audio = getAudio(type);
		audio.currentTime = 0;
		audio.play().catch(() => {});
	} catch {
		// Audio not available
	}
}
