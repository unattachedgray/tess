module.exports = {
	apps: [
		{
			name: "tess",
			cwd: "./packages/server",
			interpreter: "node",
			interpreter_args: "--import tsx/esm",
			script: "src/index.ts",
			env: {
				NODE_ENV: "production",
				PORT: "8082",
			},
			autorestart: true,
			max_restarts: 5,
		},
	],
};
