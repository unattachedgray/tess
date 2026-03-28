import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [svelte(), tailwindcss()],
	server: {
		proxy: {
			"/api": "http://localhost:8082",
			"/game-ws": {
				target: "ws://localhost:8082",
				ws: true,
			},
		},
	},
});
