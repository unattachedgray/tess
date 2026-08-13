module.exports = {
	apps: [
		{
			name: "tess",
			cwd: "./packages/server",
			interpreter: "node",
			interpreter_args: "--import tsx/esm",
			script: "src/index.ts",
			namespace: "tess",
			env: {
				NODE_ENV: "production",
				PORT: "8460",
				TESS_DISCOVERY: "off",
				// Abuse guards for a public bind — see docs/security.md §4.
				// Per-IP MUST stay below the total, or one caller can take
				// every slot and the total stops constraining anyone.
				TESS_MAX_CONNS: "10",
				TESS_MAX_CONNS_PER_IP: "3",
				TESS_AI_GLOBAL_DAY: "5000",
				// TESS_ADMIN_TOKEN is deliberately absent: /api/federation/toggle
				// fails closed without it. Set it here (or in the shell) only when
				// you actually want to toggle federation, then `pm2 startOrReload`
				// — a plain restart does not re-read this block.
			},
			autorestart: true,
			max_restarts: 5,
		},
	],
};
