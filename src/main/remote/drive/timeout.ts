// from: denislupookov/altersend@8c23d5b7d50cedae6c9dae66f82b1e235070c16a/packages/drive/src/engine/timeout.ts (Apache-2.0, see src/main/remote/drive/NOTICE)
export class Timeout {
  private readonly ms: number
  private readonly onExpire: () => void
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(ms: number, onExpire: () => void) {
    this.ms = ms
    this.onExpire = onExpire
  }

  start(): void {
    if (this.timer) return
    this.schedule()
  }

  restart(): void {
    this.stop()
    this.schedule()
  }

  stop(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null
      this.onExpire()
    }, this.ms)
    this.timer.unref?.()
  }
}
