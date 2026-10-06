// D88.9. The profile-owned service binds account selection to the backend's
// next request. ACP and the companion never handle credentials.
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import { accountEventSchema, accountIdSchema, type AccountEvent } from '../shared/accounts'
import {
  accountsReplySchema,
  accountsRequestSchema,
  type AccountsReply,
  type AccountsRequest,
} from '../shared/hostApi/accounts'
import { ACP_CONFIG_IDS, UI_TEXT } from '../shared/constants'
import { fill, formatDateTime, formatNumber } from '../shared/l10n/text'
import { formatUsd, parseUsd } from '../shared/usd'

type AccountsState = Extract<AccountsReply, { type: 'accounts/state' }>
export interface AccountsSessionPort {
  /** The selected provider's fixed public usage page, never a vendor error URL. */
  usageUrl(provider: string): string
  read(sessionId: string): Promise<AccountsState>
  /** Check canCommit immediately before the owner's synchronous selection
   * transaction. Never adopt after a session release or a newer operation. */
  use(sessionId: string, account: string, canCommit: () => boolean): Promise<AccountsState>
  subscribe(sessionId: string, listener: (event: AccountEvent) => void): () => void
}

export function accountUsageUrl(port: AccountsSessionPort, provider: string): string {
  try {
    const url = new URL(port.usageUrl(provider))
    if (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
      return url.href
  } catch {
    /* An invalid URL never leaves the fixed-error boundary. */
  }
  throw new Error(UI_TEXT.accounts.unavailable)
}

/** U's panel dispatcher, also used by the authenticated companion bridge.
 * M104 owns origin/permission/envelope checks; this is the inner payload port. */
export interface AccountsPanelPort {
  dispatch(request: AccountsRequest): Promise<AccountsReply>
  subscribe(listener: (reply: AccountsReply) => void): () => void
}
export function companionAccountsPanel(port: AccountsPanelPort): AccountsPanelPort {
  return {
    async dispatch(request) {
      const parsed = accountsRequestSchema.safeParse(request)
      if (!parsed.success) return { type: 'accounts/error', code: 'invalidAccount' }
      try {
        const reply = accountsReplySchema.safeParse(await port.dispatch(parsed.data))
        return reply.success ? reply.data : { type: 'accounts/error', code: 'unavailable' }
      } catch {
        return { type: 'accounts/error', code: 'unavailable' }
      }
    },
    subscribe(listener) {
      try {
        return port.subscribe((reply) => {
          const parsed = accountsReplySchema.safeParse(reply)
          listener(parsed.success ? parsed.data : { type: 'accounts/error', code: 'unavailable' })
        })
      } catch {
        throw new Error(UI_TEXT.accounts.unavailable)
      }
    },
  }
}

function parseState(value: unknown): AccountsState {
  const parsed = accountsReplySchema.safeParse(value)
  if (!parsed.success || parsed.data.type !== 'accounts/state')
    throw new Error(UI_TEXT.accounts.unavailable)
  return parsed.data
}

/** Account effects serialize; generation changes invalidate late reads,
 * notices and selection results without touching another session's state. */
export class AcpAccounts {
  private state: AccountsState | undefined
  private readonly earlyNotices: AccountEvent[] = []
  private noticeRevision = 0
  private generation = 0
  private isDisposed = false
  private queue: Promise<void> = Promise.resolve()
  private unsubscribe: (() => void) | undefined
  public constructor(
    private readonly sessionId: string,
    private readonly port: AccountsSessionPort,
    private readonly onChange: () => void,
    private readonly onNotice: (text: string, event: AccountEvent) => void,
  ) {}

  private async own(use: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const generation = this.generation
    const previous = this.queue
    const operation = (async () => {
      await previous
      const isCurrent = () => !this.isDisposed && generation === this.generation
      if (!isCurrent()) throw new Error(UI_TEXT.accounts.unavailable)
      await use(isCurrent)
      if (!isCurrent()) throw new Error(UI_TEXT.accounts.unavailable)
    })()
    this.queue = (async () => {
      try {
        await operation
      } catch {
        /* The caller receives the failure; the owner remains usable. */
      }
    })()
    await operation
  }

  private label(id: string): string {
    return this.state?.accounts.find((row) => row.id === id)?.label ?? id
  }

  private notice(event: AccountEvent): string {
    if (event.type === 'swap') {
      const trigger = event.trigger
      const threshold =
        trigger.kind === 'vendorLimit'
          ? UI_TEXT.accounts.vendorLimit
          : `${trigger.metric}: ${trigger.metric === 'spendUsd' ? formatUsd(parseUsd(trigger.threshold)) : formatNumber(trigger.threshold)} (${trigger.period})`
      return `${fill(UI_TEXT.accounts.swapNotice, { provider: event.provider, account: this.label(event.account), previous: this.label(event.previousAccount), threshold })} ${fill(UI_TEXT.accounts.coldCache, { cost: formatUsd(parseUsd(event.coldCacheUsd)) })}`
    }
    if (event.type === 'spread')
      return `${UI_TEXT.accounts.spreadEvent}: ${event.provider} · ${this.label(event.account)}`
    const url = accountUsageUrl(this.port, event.provider)
    const stopped =
      event.trigger.resetAt === null
        ? fill(UI_TEXT.accounts.resetUnknown, { provider: event.provider })
        : fill(UI_TEXT.accounts.stopped, {
            provider: event.provider,
            reset: formatDateTime(Date.parse(event.trigger.resetAt)),
          })
    return `${stopped} ${url}`
  }

  private current(): string {
    const state = this.state
    if (!state?.currentAccount) throw new Error(UI_TEXT.accounts.unavailable)
    return `${UI_TEXT.accounts.current}: ${state.provider} · ${this.label(state.currentAccount)}`
  }

  public async start(): Promise<void> {
    const receive = (event: AccountEvent) => {
      if (this.isDisposed) return
      const parsed = accountEventSchema.safeParse(event)
      if (!parsed.success) return
      const notice = parsed.data
      if (this.state === undefined) {
        this.earlyNotices.push(notice)
        return
      }
      if (this.state.provider !== notice.provider) return
      const isKnown = this.state.accounts.some((row) => row.id === notice.account)
      if (!isKnown) return
      if (
        notice.type === 'swap' &&
        this.state.accounts.every((row) => row.id !== notice.previousAccount)
      )
        return
      // The owner has committed account adoption and its event together (P).
      if (notice.type === 'swap') {
        this.noticeRevision += 1
        this.state = { ...this.state, currentAccount: notice.account }
        this.onChange()
      }
      let text: string
      try {
        text = this.notice(notice)
      } catch {
        text = UI_TEXT.accounts.unavailable
      }
      this.onNotice(text, notice)
    }
    try {
      this.unsubscribe = this.port.subscribe(this.sessionId, receive)
      await this.own(async (isCurrent) => {
        const state = parseState(await this.port.read(this.sessionId))
        if (!isCurrent()) {
          return
        }

        this.state = state
        for (const notice of this.earlyNotices.splice(0)) receive(notice)
      })
    } catch {
      throw new Error(UI_TEXT.accounts.unavailable)
    }
  }

  public option(): SessionConfigOption[] {
    const state = this.state
    if (this.isDisposed || !state?.currentAccount) return []
    return [
      {
        id: ACP_CONFIG_IDS.account,
        name: UI_TEXT.accounts.current,
        type: 'select',
        currentValue: state.currentAccount,
        options: state.accounts.map((account) => ({
          value: account.id,
          name: `${state.provider} · ${account.label}`,
        })),
      },
    ]
  }

  public async use(account: string, canCommit: () => boolean): Promise<void> {
    await this.own(async (isCurrent) => {
      if (
        !accountIdSchema.safeParse(account).success ||
        !this.state?.accounts.some((row) => row.id === account)
      )
        throw new Error(UI_TEXT.accounts.invalidAccount)
      const revision = this.noticeRevision
      const canAdopt = () => isCurrent() && canCommit()
      const state = parseState(await this.port.use(this.sessionId, account, canAdopt))
      if (!canAdopt()) throw new Error(UI_TEXT.accounts.unavailable)
      if (state.provider !== this.state.provider || state.currentAccount !== account)
        throw new Error(UI_TEXT.accounts.invalidAccount)
      if (revision !== this.noticeRevision) {
        if (this.state.currentAccount !== account) throw new Error(UI_TEXT.accounts.unavailable)
        return
      }
      this.state = state
      this.onChange()
    })
  }

  public async command(text: string, canCommit: () => boolean): Promise<string | undefined> {
    if (!/^\/accounts(?:\s|$)/.test(text)) return
    if (this.isDisposed || this.state === undefined) throw new Error(UI_TEXT.accounts.unavailable)
    const [, action = 'list', account, ...rest] = text.trim().split(/\s+/)
    if (rest.length > 0) throw new Error(UI_TEXT.accounts.invalidAccount)
    if (action === 'use' && account !== undefined) {
      await this.use(account, canCommit)
      return this.current()
    }
    if (action === 'current' && account === undefined) return this.current()
    if (action === 'list' && account === undefined) return JSON.stringify(this.state.accounts)
    if (action === 'thresholds') {
      const rows = this.state.accounts.filter((row) => account === undefined || row.id === account)
      if (rows.length === 0) throw new Error(UI_TEXT.accounts.invalidAccount)
      return JSON.stringify(rows.map((row) => ({ id: row.id, thresholds: row.thresholds })))
    }
    throw new Error(UI_TEXT.accounts.invalidAccount)
  }

  public dispose(): void {
    this.isDisposed = true
    this.generation += 1
    this.unsubscribe?.()
    this.earlyNotices.length = 0
  }
}
