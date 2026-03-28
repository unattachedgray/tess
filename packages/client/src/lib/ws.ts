import type { ClientMessage, ServerMessage } from "@tess/shared";

type TypeHandler = (msg: unknown) => void;

export class WsClient {
	private ws: WebSocket | null = null;
	private handlers = new Map<string, TypeHandler[]>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingMessages: string[] = [];
	private url: string;
	private connected = false;

	constructor(url?: string) {
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		this.url = url ?? `${proto}//${window.location.host}/game-ws`;
	}

	connect(): void {
		if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
			return;
		}
		this.ws = new WebSocket(this.url);

		this.ws.onopen = () => {
			console.log("[ws] connected");
			this.connected = true;
			// Flush any messages queued while disconnected
			for (const msg of this.pendingMessages) {
				this.ws!.send(msg);
			}
			this.pendingMessages = [];
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
			this.connected = false;
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		};

		this.ws.onerror = () => {};
	}

	send(msg: ClientMessage): void {
		const data = JSON.stringify(msg);
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(data);
		} else {
			// Queue message to send when connected
			this.pendingMessages.push(data);
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

	clearHandlers(): void {
		this.handlers.clear();
	}

	disconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.ws?.close();
		this.ws = null;
		this.connected = false;
	}
}
