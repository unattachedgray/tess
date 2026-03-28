import type { ClientMessage, ServerMessage } from "@tess/shared";

type TypeHandler = (msg: unknown) => void;

export class WsClient {
	private ws: WebSocket | null = null;
	private handlers = new Map<string, TypeHandler[]>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private url: string;

	constructor(url?: string) {
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		this.url = url ?? `${proto}//${window.location.host}/ws`;
	}

	connect(): void {
		this.ws = new WebSocket(this.url);

		this.ws.onopen = () => {
			console.log("[ws] connected");
		};

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data as string) as ServerMessage;
				const handlers = this.handlers.get(msg.type);
				if (handlers) {
					for (const h of handlers) h(msg);
				}
			} catch (err) {
				console.error("[ws] parse error:", err);
			}
		};

		this.ws.onclose = () => {
			console.log("[ws] disconnected, reconnecting in 2s...");
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		};

		this.ws.onerror = (err) => {
			console.error("[ws] error:", err);
		};
	}

	send(msg: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	on<T extends ServerMessage["type"]>(
		type: T,
		handler: (msg: Extract<ServerMessage, { type: T }>) => void,
	): void {
		const existing = this.handlers.get(type) ?? [];
		existing.push(handler as TypeHandler);
		this.handlers.set(type, existing);
	}

	off(type: string): void {
		this.handlers.delete(type);
	}

	disconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.ws?.close();
		this.ws = null;
	}
}
