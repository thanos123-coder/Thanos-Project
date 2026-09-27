import { TaskCancelledError } from '../shared/errors.js';

/**
 * Cooperative cancellation. "Cancellation stops future work and prevents late
 * results from being silently committed." Child tokens are cancelled with their
 * parent; cancelling a child never cancels the parent.
 */
export class CancellationToken {
  private cancelledReason: string | null = null;
  private readonly listeners = new Set<(reason: string) => void>();
  private readonly children = new Set<CancellationToken>();

  constructor(readonly taskId: string, parent?: CancellationToken) {
    if (parent) {
      if (parent.isCancelled) this.cancelledReason = parent.reason;
      else parent.children.add(this);
    }
  }

  get isCancelled(): boolean {
    return this.cancelledReason !== null;
  }

  get reason(): string {
    return this.cancelledReason ?? '';
  }

  cancel(reason: string): void {
    if (this.cancelledReason !== null) return;
    this.cancelledReason = reason;
    for (const l of this.listeners) l(reason);
    this.listeners.clear();
    for (const c of this.children) c.cancel(reason);
  }

  onCancel(listener: (reason: string) => void): () => void {
    if (this.cancelledReason !== null) {
      listener(this.cancelledReason);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  throwIfCancelled(): void {
    if (this.cancelledReason !== null) throw new TaskCancelledError(this.taskId);
  }

  child(taskId: string): CancellationToken {
    return new CancellationToken(taskId, this);
  }
}
