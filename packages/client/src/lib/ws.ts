import type { ClientMessage, ServerMessage } from "@tess/shared";

type TypeHandler = (msg: unknown) => void;

export class WsClient {
	private ws: WebSocket | null = null;
	private handlers = new Map<string, TypeHandler[]>();
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingMessages: string[] = [];
	private url: string;
	private connected = false;
	private wasConnected = false; // tracks if we ever had a connection
	/** Called when connection state changes — wire to appState */
	onConnectionChange?: (connected: boolean) => void;

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
			this.onConnectionChange?.(true);
			// If reconnecting after a drop, reload to get fresh state
			if (this.wasConnected) {
				console.log("[ws] reconnected after drop — reloading");
				window.location.reload();
				return;
			}
			this.wasConnected = true;
			// Flush any messages queued while disconnected
			for (const msg of this.pendingMessages) {
				this.ws!.send(msg);
			}
			this.pendingMessages = [];
		};

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data as string);
				// Basic type guard — reject messages without a valid type field
				if (!msg || typeof msg.type !== "string") {
					console.warn("[ws] invalid message (no type)");
					return;
				}
				const typedMsg = msg as ServerMessage;
				// Debug: log all non-routine messages
				if (!["PLAYER_COUNT", "CLOCK_UPDATE"].includes(typedMsg.type)) {
					console.log("[ws] <<", typedMsg.type, JSON.stringify(typedMsg).slice(0, 150));
				}
				const handlers = this.handlers.get(typedMsg.type);
				if (handlers) {
					for (const h of handlers) h(typedMsg);
				} else {
					console.warn("[ws] no handler for", typedMsg.type);
				}
			} catch (err) {
				console.error("[ws] parse error:", err);
			}
		};

		this.ws.onclose = () => {
			this.connected = false;
			this.onConnectionChange?.(false);
			this.reconnectTimer = setTimeout(() => this.connect(), 2000);
		};

		this.ws.onerror = () => {};
	}

	send(msg: ClientMessage): void {
		const data = JSON.stringify(msg);
		console.log("[ws] >>", msg.type, JSON.stringify(msg).slice(0, 100));
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

	/** Log all registered handler types (for debugging). */
	debugHandlers(): void {
		console.log("[ws] registered handlers:", Array.from(this.handlers.keys()));
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
