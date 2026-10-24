// Live extension sessions on this server process, keyed by userId:deviceId.
// Single-process for now. Multi-pod presence (Redis) plugs in behind this API.
import { CloseCode } from "@bigfish/contracts";
import { type DeviceSession, sessionKey } from "./session.js";

export const MAX_DEVICES_PER_USER = 3;

export class SessionRegistry {
  private readonly sessions = new Map<string, DeviceSession>();

  // A newer connection for the same device replaces the old one.
  add(session: DeviceSession): void {
    const key = session.key;
    const previous = this.sessions.get(key);
    this.sessions.set(key, session);
    // Only remove the entry if it still points at this session, so a replaced
    // session closing late does not drop its replacement.
    session.onClose(() => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
    });
    if (previous && previous !== session) previous.close(CloseCode.REPLACED, "replaced by a newer connection");
  }

  get(userId: string, deviceId: string): DeviceSession | undefined {
    const session = this.sessions.get(sessionKey(userId, deviceId));
    return session?.state === "ready" ? session : undefined;
  }

  listForUser(userId: string): DeviceSession[] {
    return [...this.sessions.values()].filter((s) => s.info.userId === userId);
  }

  all(): DeviceSession[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }

  closeAll(code: number = CloseCode.SERVICE_RESTART, reason = "server shutting down"): void {
    for (const session of this.sessions.values()) session.close(code, reason);
    this.sessions.clear();
  }
}
