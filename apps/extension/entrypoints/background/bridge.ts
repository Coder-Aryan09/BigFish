// BigFish WebSocket Client: Maintains the bridge to localhost:8787/bridge
import type { BridgeMessage } from "@bigfish/contracts";
import { executor } from "./executor.js";

export class BridgeWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string = "ws://localhost:8787/bridge";
  private reconnectDelay: number = 1000;
  private pingInterval: any = null;
  private isKilled: boolean = false;

  connect() {
    if (this.isKilled) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("[BigFish Bridge] Connected to server");
        this.reconnectDelay = 1000;
        this.send({ type: "hello", token: "bigfish-extension", ver: "0.1.0" });
        this.startHeartbeat();
      };

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data) as BridgeMessage;
          await this.handleMessage(msg);
        } catch (err) {
          console.error("[BigFish Bridge] Bad message", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[BigFish Bridge] Disconnected. Reconnecting in", this.reconnectDelay);
        this.cleanup();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn("[BigFish Bridge] WebSocket error", err);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.isKilled) return;
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
      this.connect();
    }, this.reconnectDelay);
  }

  private startHeartbeat() {
    clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 20000);
  }

  private cleanup() {
    clearInterval(this.pingInterval);
    this.ws = null;
  }

  send(msg: BridgeMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  kill() {
    this.isKilled = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
    }
  }

  private async handleMessage(msg: BridgeMessage) {
    if (msg.type === "ping") {
      this.send({ type: "pong" });
      return;
    }

    if (msg.type === "call") {
      const res = await executor.execute(msg.tool, msg.args, msg.client);
      this.send({
        type: "result",
        id: msg.id,
        ok: res.ok,
        text: res.text,
        meta: res.meta,
      });
      return;
    }

    if (msg.type === "abort") {
      console.log("[BigFish Bridge] Abort request received");
      return;
    }
  }
}

export const bridgeClient = new BridgeWebSocketClient();
