module.exports = {
	apps: [
		{
			name: "tess",
			cwd: "./packages/server",
			script: "npx",
			args: "tsx src/index.ts",
			env: {
				NODE_ENV: "production",
				PORT: "8082",
			},
			autorestart: true,
			max_restarts: 5,
		},
	],
};
