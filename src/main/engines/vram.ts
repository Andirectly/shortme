/**
 * VRAM-Sequenzierung: ASR und LLM nie gleichzeitig im VRAM (CLAUDE.md).
 * Jede Engine ist ein „Resident“; `use()` entlädt alle anderen, lädt bei Bedarf und führt die Stufe exklusiv aus.
 */
export interface Resident {
  name: string
  load(): Promise<void>
  unload(): Promise<void>
}

export class VramSequencer {
  private residents = new Map<string, Resident>()
  private current: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  register(r: Resident): void { this.residents.set(r.name, r) }
  get loaded(): string | null { return this.current }

  use<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const target = this.residents.get(name)
      if (!target) throw new Error(`Unbekannte Engine: ${name}`)
      if (this.current && this.current !== name) {
        await this.residents.get(this.current)!.unload()
        this.current = null
      }
      if (this.current !== name) {
        await target.load()
        this.current = name
      }
      return fn()
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async releaseAll(): Promise<void> {
    await this.queue.catch(() => undefined)
    if (this.current) { await this.residents.get(this.current)!.unload(); this.current = null }
  }
}
