import { readFileSync } from "node:fs";
import { join } from "node:path";

let active = 0;

/** Public coaching has no direct provider credentials or premium fallback. */
export async function callGateway(prompt: string, timeoutMs: number, job: string): Promise<string> {
	if (active >= 2) throw new Error("Coaching capacity reached");
	const credentials = process.env.CREDENTIALS_DIRECTORY;
	if (!credentials) throw new Error("Coaching credential unavailable");
	const key = readFileSync(join(credentials, "cascade-key"), "utf8").trim();
	if (!key) throw new Error("Coaching credential unavailable");
	const endpoint = new URL(process.env.TESS_GATEWAY_URL ?? "http://127.0.0.1:8090/v1/chat/completions");
	if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password)
		throw new Error("Coaching requires the local gateway");
	active++;
	try {
		const response = await fetch(endpoint, {
			method: "POST",
			redirect: "error",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify({
				model: "auto",
				routing: { version: 1, project: "tess", job, execution: "interactive", strength: "economy", allow_escalation: false, requirements: [] },
				messages: [{ role: "user", content: prompt }],
				max_tokens: 2048,
				stream: false,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error(`Coaching gateway HTTP ${response.status}`);
		const data = await response.json() as { choices?: { message?: { content?: string } }[] };
		const text = data.choices?.[0]?.message?.content;
		if (typeof text !== "string" || !text.trim()) throw new Error("Coaching gateway returned empty response");
		return text.trim();
	} finally {
		active--;
	}
}
