import type { ChatSurface } from '../views/chatSurface'

/** New surfaces receive insert-only loads once their composer is listening. */
export class PromptInsertion {
  private readonly ready = new Map<string, ChatSurface>()
  private readonly closed = new Set<string>()
  private pending: { readonly text: string; readonly target: string }[] = []
  public constructor(
    private readonly deps: { active(): ChatSurface | undefined; open(): Promise<string> },
  ) {}

  private flush(surface: ChatSurface): void {
    if (!this.ready.has(surface.id)) return
    const waiting = this.pending.filter((load) => load.target === surface.id)
    this.pending = this.pending.filter((load) => !waiting.includes(load))
    for (const load of waiting) {
      surface.post({ type: 'insertText', text: load.text })
      surface.post({ type: 'focusInput' })
    }
  }

  public surfaceReady(surface: ChatSurface): void {
    this.closed.delete(surface.id)
    this.ready.set(surface.id, surface)
    this.flush(surface)
  }

  public surfaceClosed(surface: ChatSurface): void {
    this.ready.delete(surface.id)
    this.closed.add(surface.id)
    this.pending = this.pending.filter((load) => load.target !== surface.id)
  }

  public async insert(text: string): Promise<void> {
    const active = this.deps.active()
    const target = active?.id ?? (await this.deps.open())
    if (this.closed.has(target)) return
    this.pending.push({ text, target })
    const surface = active ?? this.ready.get(target)
    if (surface === undefined) return
    surface.reveal()
    this.flush(surface)
  }
}
