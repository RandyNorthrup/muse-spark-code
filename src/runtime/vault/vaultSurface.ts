import {
  vaultClientMessageSchema,
  vaultHostMessageSchema,
} from '../../shared/hostApi/vaultMessages'
import { UI_TEXT } from '../../shared/constants'

export interface VaultPanelPort {
  /** U routes only parsed public messages to its panel host. */
  dispatch(
    message: ReturnType<typeof vaultClientMessageSchema.parse>,
    signal: AbortSignal,
  ): Promise<unknown>
  /** The host's local terminal; values entered there never pass through this bridge. */
  terminal(command: 'add' | 'edit', itemId: string | null, signal: AbortSignal): Promise<void>
}

/** M104 supplies authenticated companion/native connections; callers cannot self-claim authentication. */
export class VaultSurface {
  private closed = false
  private generation = 0
  private controller = new AbortController()
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly port: VaultPanelPort) {}
  private isCurrent(generation: number): boolean {
    return !this.closed && generation === this.generation
  }
  async dispatch(raw: unknown): Promise<ReturnType<typeof vaultHostMessageSchema.parse> | null> {
    try {
      const message = vaultClientMessageSchema.parse(raw)
      if (message.type === 'vaultLock' && !this.closed) {
        this.generation += 1
        this.controller.abort()
        this.controller = new AbortController()
        this.tail = Promise.resolve()
      }
      const generation = this.generation
      const signal = this.controller.signal
      const previous = this.tail
      const task = (async () => {
        try {
          await previous
        } catch {
          /* Each caller receives its failure; later requests stay serialized. */
        }
        if (!this.isCurrent(generation)) throw new Error(UI_TEXT.vault.noAccess)
        if (message.type === 'vaultAdd' || message.type === 'vaultEdit') {
          await this.port.terminal(
            message.type === 'vaultAdd' ? 'add' : 'edit',
            message.type === 'vaultEdit' ? message.itemId : null,
            signal,
          )
          if (!this.isCurrent(generation)) throw new Error(UI_TEXT.vault.noAccess)
          return null
        }
        const response = vaultHostMessageSchema.parse(await this.port.dispatch(message, signal))
        if (!this.isCurrent(generation)) throw new Error(UI_TEXT.vault.noAccess)
        return response
      })()
      this.tail = task
      return await task
    } catch {
      throw new Error(UI_TEXT.vault.noAccess)
    }
  }
  close(): void {
    this.closed = true
    this.controller.abort()
    this.generation += 1
  }
}
