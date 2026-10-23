import type { HostServices, MhpResult } from '../../shared/hostApi/methods'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import { UI_TEXT } from '../../shared/constants'
import { whatsNewMessageSchema, type WhatsNewMessage } from '../../shared/whatsNewMessages'
import { parseWhatsNewContent } from '../../core/whatsNew/whatsNewContent'
import { releasesToShow } from '../../core/whatsNew/whatsNewVersions'
import type { PanelView } from '../../runtime/panel/surfaces'
import type { Logger } from '../logger'
import { renderWhatsNewPage, type WhatsNewPage, type WhatsNewPageOptions } from './whatsNewHtml'

type SurfaceId = MhpResult<'surfaces/open'>['surfaceId']
export interface PortableWhatsNewDeps {
  readonly host: HostServices
  readonly sessionId: () => string
  /** Exact packaged whatsNew.json, parsed with the existing bounded content schema. */
  readonly readContent: () => Promise<string>
  readonly current: string
  readonly assets: (
    binding: MhpPanelBinding,
  ) => Pick<WhatsNewPageOptions, 'cspSource' | 'nonce' | 'scriptUri' | 'styleUri' | 'locale'>
  /** Native/companion owner installs HTML and the immutable binding before ready. */
  readonly present: (binding: MhpPanelBinding, html: string) => Promise<void>
  readonly executeCommand: (id: string) => Promise<void>
  readonly openSetting: (key: string) => Promise<void>
  readonly isShownOnUpdate: () => boolean
  readonly setShownOnUpdate: (isShown: boolean) => Promise<void>
  readonly log: Logger
}
interface ShownPage {
  readonly id: SurfaceId
  readonly binding: MhpPanelBinding
  readonly page: WhatsNewPage
  readonly render: () => WhatsNewPage
}

function noState(): void {
  /* This HTML surface has no outbound state vocabulary. */
}
function subscribeToHtml(): () => void {
  return noState
}

/** Host-rendered release notes with page-owned allowlisted action/link indices. */
export class PortableWhatsNew {
  private readonly pages = new Map<string, ShownPage>()
  private readonly acquired = new Set<SurfaceId>()
  private readonly inFlight = new Set<Promise<void>>()
  private opening: { readonly sessionId: string; readonly work: Promise<void> } | undefined
  private generation = 0
  private disposal: Promise<void> | undefined
  private isDisposed = false

  public constructor(private readonly deps: PortableWhatsNewDeps) {}

  private isCurrent(sessionId: string, generation: number): boolean {
    return !this.isDisposed && sessionId === this.deps.sessionId() && generation === this.generation
  }

  private async close(id: SurfaceId): Promise<void> {
    // An authoritative close may already have retired this generation's surface.
    if (!this.acquired.has(id)) return
    // Retire input before awaiting the carrier; failed cleanup remains acquired.
    this.pages.delete(String(id))
    await this.deps.host.request('surfaces/close', { surfaceId: id })
    this.acquired.delete(id)
  }

  private async notifyFailure(code: string): Promise<void> {
    this.deps.log.warn(code)
    if (this.isDisposed) return
    try {
      await this.deps.host.request('ui/notify', {
        severity: 'error',
        message: UI_TEXT.fallbackActionFailed,
      })
    } catch {
      this.deps.log.warn('MHP_WHATS_NEW_NOTICE_FAILED')
    }
  }

  private async act(target: ShownPage, message: WhatsNewMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'openLink': {
          const uri = target.page.links[message.index]
          if (uri === undefined) {
            await this.notifyFailure('MHP_WHATS_NEW_INVALID_INDEX')
            return
          }
          await this.deps.host.request('ui/openExternal', { uri })
          break
        }
        case 'tryIt': {
          const entry = target.page.tries[message.index]
          if (entry === undefined) {
            await this.notifyFailure('MHP_WHATS_NEW_INVALID_INDEX')
            return
          }
          if (entry.kind === 'command') await this.deps.executeCommand(entry.id)
          else await this.deps.openSetting(entry.id)
          break
        }
        case 'hideOnUpdate': {
          await this.deps.setShownOnUpdate(!message.isHidden)
          break
        }
      }
    } catch {
      await this.notifyFailure('MHP_WHATS_NEW_ACTION_FAILED')
    }
  }

  private async open(
    from: string | undefined,
    sessionId: string,
    generation: number,
  ): Promise<void> {
    const content = parseWhatsNewContent(await this.deps.readContent())
    if (!this.isCurrent(sessionId, generation)) return
    const result = await this.deps.host.request('surfaces/open', {
      kind: 'whatsNew',
      placement: 'tab',
      sessionId,
    })
    this.acquired.add(result.surfaceId)
    if (!this.isCurrent(sessionId, generation)) {
      await this.close(result.surfaceId)
      return
    }
    const binding: MhpPanelBinding = {
      surface: String(result.surfaceId),
      surfaceKind: 'whatsNew',
      sessionId,
    }
    const render = () =>
      renderWhatsNewPage({
        ...this.deps.assets(binding),
        current: this.deps.current,
        from,
        releases: releasesToShow(content.releases, from, this.deps.current),
        isShownOnUpdate: this.deps.isShownOnUpdate(),
      })
    try {
      const page = render()
      const previous = Array.from(this.pages, ([, old]) => old)
      this.pages.set(binding.surface, { id: result.surfaceId, binding, page, render })
      await this.deps.present(binding, page.html)
      if (!this.isCurrent(sessionId, generation)) {
        await this.close(result.surfaceId)
        return
      }
      for (const old of previous) await this.close(old.id)
    } catch {
      try {
        await this.close(result.surfaceId)
      } catch {
        this.deps.log.warn('MHP_WHATS_NEW_CLOSE_FAILED')
      }
      throw new Error('MHP_WHATS_NEW_PRESENT_FAILED')
    }
  }

  private async release(): Promise<void> {
    this.isDisposed = true
    await Promise.allSettled(this.inFlight)
    let hasFailure = false
    for (const id of this.acquired) {
      try {
        await this.close(id)
      } catch {
        hasFailure = true
        this.deps.log.warn('MHP_WHATS_NEW_CLOSE_FAILED')
      }
    }
    if (hasFailure) throw new Error('MHP_WHATS_NEW_CLOSE_FAILED')
  }

  public async show(from?: string): Promise<void> {
    if (this.isDisposed) throw new Error('MHP_PRESENTATION_DISPOSED')
    const sessionId = this.deps.sessionId()
    if (this.opening?.sessionId === sessionId) {
      await this.opening.work
      return
    }
    const generation = ++this.generation
    const work = this.open(from, sessionId, generation)
    this.opening = { sessionId, work }
    this.inFlight.add(work)
    try {
      await work
    } finally {
      this.inFlight.delete(work)
      if (generation === this.generation) this.opening = undefined
    }
  }

  public view(binding: MhpPanelBinding): PanelView | undefined {
    const target = this.pages.get(binding.surface)
    if (
      binding.surfaceKind !== 'whatsNew' ||
      this.isDisposed ||
      binding.sessionId !== this.deps.sessionId() ||
      binding.sessionId !== target?.binding.sessionId
    )
      return
    return {
      subscribe: subscribeToHtml,
      handle: async (raw) => {
        if (
          this.isDisposed ||
          this.pages.get(binding.surface) !== target ||
          binding.sessionId !== this.deps.sessionId()
        )
          throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
        const work =
          raw === null
            ? this.deps.present(binding, target.render().html)
            : this.act(target, whatsNewMessageSchema.parse(raw))
        this.inFlight.add(work)
        try {
          try {
            await work
          } catch {
            await this.notifyFailure('MHP_WHATS_NEW_RELOAD_FAILED')
          }
        } finally {
          this.inFlight.delete(work)
        }
      },
    }
  }

  public closed(surfaceId: string): void {
    const owned = [...this.acquired].find((id) => String(id) === surfaceId)
    if (owned !== undefined) this.acquired.delete(owned)
    this.pages.delete(surfaceId)
  }

  public dispose(): Promise<void> {
    this.disposal ??= this.release()
    return this.disposal
  }
}
