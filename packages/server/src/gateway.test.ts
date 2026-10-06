import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { callGateway } from "./gateway.js";

const directory = mkdtempSync(join(tmpdir(), "tess-gateway-test-"));
const oldCredentials = process.env.CREDENTIALS_DIRECTORY;
const oldUrl = process.env.TESS_GATEWAY_URL;
let status = 200;
let requests: { authorization?: string; body: any }[] = [];
const server = createServer(async (request, response) => {
	let body = "";
	for await (const chunk of request) body += chunk;
	requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(status === 200 ? { choices: [{ message: { content: "Fixture coaching" } }] } : { error: "sensitive provider body" }));
});
beforeAll(async () => {
	writeFileSync(join(directory, "cascade-key"), "synthetic-test-key", { mode: 0o600 });
	process.env.CREDENTIALS_DIRECTORY = directory;
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as { port: number };
	process.env.TESS_GATEWAY_URL = `http://127.0.0.1:${address.port}/v1/chat/completions`;
});
afterAll(async () => {
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	rmSync(directory, { recursive: true });
	if (oldCredentials === undefined) delete process.env.CREDENTIALS_DIRECTORY;
	else process.env.CREDENTIALS_DIRECTORY = oldCredentials;
	if (oldUrl === undefined) delete process.env.TESS_GATEWAY_URL;
	else process.env.TESS_GATEWAY_URL = oldUrl;
});
it("sends both jobs through the economy gateway with a file credential", async () => {
	for (const job of ["position-coaching", "game-summary"]) {
		expect(await callGateway("synthetic fixture", 2000, job)).toBe("Fixture coaching");
		const request = requests.at(-1)!;
		expect(request.authorization).toBe("Bearer synthetic-test-key");
		expect(request.body.routing).toEqual({ version: 1, project: "tess", job, execution: "interactive", strength: "economy", allow_escalation: false, requirements: [] });
	}
});
it("fails without retries or provider details on an exhausted gateway", async () => {
	status = 503;
	const before = requests.length;
	await expect(callGateway("fixture", 2000, "position-coaching")).rejects.toThrow(/^Coaching gateway HTTP 503$/);
	expect(requests.length).toBe(before + 1);
});
it("fails closed without the dedicated credential", async () => {
	delete process.env.CREDENTIALS_DIRECTORY;
	await expect(callGateway("fixture", 2000, "position-coaching")).rejects.toThrow("credential unavailable");
	process.env.CREDENTIALS_DIRECTORY = directory;
});
