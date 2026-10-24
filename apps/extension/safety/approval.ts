// BigFish Approval Manager: Manages pending user decisions and modals.

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: any;
  reason: string;
  origin: string;
  fingerprint: string;
  createdAt: number;
}

class ApprovalManager {
  private pending: Map<string, { request: ApprovalRequest; resolve: (approved: boolean) => void }> = new Map();
  private preApprovedFingerprints: Set<string> = new Set();
  private listeners: ((req: ApprovalRequest) => void)[] = [];

  computeActionFingerprint(tool: string, args: any, origin: string): string {
    const raw = `${tool}:${JSON.stringify(args)}:${origin}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  isPreApproved(fingerprint: string): boolean {
    return this.preApprovedFingerprints.has(fingerprint);
  }

  onApprovalRequested(listener: (req: ApprovalRequest) => void) {
    this.listeners.push(listener);
  }

  async awaitDecision(request: ApprovalRequest, timeoutMs: number = 45000): Promise<boolean> {
    const fp = request.fingerprint;
    if (this.preApprovedFingerprints.has(fp)) {
      this.preApprovedFingerprints.delete(fp);
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(false);
      }, timeoutMs);

      this.pending.set(request.id, {
        request,
        resolve: (approved: boolean) => {
          clearTimeout(timer);
          this.pending.delete(request.id);
          if (approved) {
            this.preApprovedFingerprints.add(fp);
          }
          resolve(approved);
        },
      });

      // Notify side panel or UI
      for (const listener of this.listeners) {
        try {
          listener(request);
        } catch (e) {
          console.error("[BigFish Approval] Listener error", e);
        }
      }
    });
  }

  resolveDecision(id: string, approved: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(approved);
    return true;
  }

  getPendingList(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }
}

export const approvals = new ApprovalManager();
