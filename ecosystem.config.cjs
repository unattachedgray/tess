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
			},
			autorestart: true,
			max_restarts: 5,
		},
	],
};
