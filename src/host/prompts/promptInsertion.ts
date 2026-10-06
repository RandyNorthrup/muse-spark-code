import type { ChatSurface } from '../views/chatSurface'

/** New surfaces receive insert-only loads once their composer is listening. */
export class PromptInsertion {
  private readonly ready = new Set<string>()
  private pending: { readonly text: string; readonly target: string | undefined }[] = []
  public constructor(
    private readonly deps: { active(): ChatSurface | undefined; open(): Promise<void> },
  ) {}

  private flush(surface: ChatSurface): void {
    if (!this.ready.has(surface.id)) return
    const waiting = this.pending.filter(
      (load) => load.target === undefined || load.target === surface.id,
    )
    this.pending = this.pending.filter((load) => !waiting.includes(load))
    for (const load of waiting) {
      surface.post({ type: 'insertText', text: load.text })
      surface.post({ type: 'focusInput' })
    }
  }

  public surfaceReady(surface: ChatSurface): void {
    this.ready.add(surface.id)
    this.flush(surface)
  }

  public surfaceClosed(surface: ChatSurface): void {
    this.ready.delete(surface.id)
    this.pending = this.pending.filter((load) => load.target !== surface.id)
  }

  public async insert(text: string): Promise<void> {
    const active = this.deps.active()
    const load = { text, target: active?.id }
    this.pending.push(load)
    try {
      if (active === undefined) await this.deps.open()
      const surface = active ?? this.deps.active()
      if (surface !== undefined) {
        surface.reveal()
        this.flush(surface)
      }
    } catch (error: unknown) {
      this.pending = this.pending.filter((entry) => entry !== load)
      throw error
    }
  }
}
