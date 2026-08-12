export interface PreviewSchedulerOptions {
  normalDelayMs?: number;
  largeDelayMs?: number;
  largeDocumentThreshold?: number;
  idleTimeoutMs?: number;
}

export class PreviewScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private idleHandle: number | undefined;
  private pending: (() => void) | undefined;
  private readonly normalDelayMs: number;
  private readonly largeDelayMs: number;
  private readonly threshold: number;
  private readonly idleTimeoutMs: number;

  constructor(options: PreviewSchedulerOptions = {}) {
    this.normalDelayMs = options.normalDelayMs ?? 120;
    this.largeDelayMs = options.largeDelayMs ?? 300;
    this.threshold = options.largeDocumentThreshold ?? 500_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 250;
  }

  schedule(length: number, visible: boolean, render: () => void): void {
    this.cancelScheduledWork();
    this.pending = render;
    if (!visible) return;
    this.timer = setTimeout(() => this.runWhenIdle(), length > this.threshold ? this.largeDelayMs : this.normalDelayMs);
  }

  flush(): void {
    if (!this.pending) return;
    this.cancelScheduledWork(false);
    const render = this.pending;
    this.pending = undefined;
    render();
  }

  cancel(): void {
    this.cancelScheduledWork();
    this.pending = undefined;
  }

  private runWhenIdle(): void {
    this.timer = undefined;
    if (typeof requestIdleCallback === "function") {
      this.idleHandle = requestIdleCallback(() => {
        this.idleHandle = undefined;
        this.flush();
      }, { timeout: this.idleTimeoutMs });
    } else {
      this.flush();
    }
  }

  private cancelScheduledWork(cancelIdle = true): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (cancelIdle && this.idleHandle !== undefined && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(this.idleHandle);
      this.idleHandle = undefined;
    }
  }
}
