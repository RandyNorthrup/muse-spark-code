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
import { fill, formatNumber } from '../shared/l10n/text'
import { formatUsd, parseUsd } from '../shared/accountUsd'
import { accountStopText, accountUsageUrl, type AccountUsagePort } from './accountText'

export { accountErrorText } from './accountText'

type AccountsState = Extract<AccountsReply, { type: 'accounts/state' }>
export interface AccountsSessionPort extends AccountUsagePort {
  read(sessionId: string): Promise<AccountsState>
  /** Check canCommit immediately before the owner's synchronous selection
   * transaction. Never adopt after a session release or a newer operation. */
  use(sessionId: string, account: string, canCommit: () => boolean): Promise<AccountsState>
  /** Publish a fresh state from the live account store on metadata changes,
   * as well as notices from the same owner's committed adoption transaction. */
  subscribe(sessionId: string, listener: (event: AccountEvent | AccountsState) => void): () => void
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
  private readonly earlyNotices: (AccountEvent | AccountsState)[] = []
  // The account authority's generation fences pending backend adoption.
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
      // Display rule: a shortened cap renders with ceiling, never below the
      // exact trigger, so an exact reach always shows value >= cap. Reach
      // state itself comes from the exact trigger event, never the text.
      const threshold =
        trigger.kind === 'vendorLimit'
          ? UI_TEXT.accounts.vendorLimit
          : `${trigger.metric}: ${trigger.metric === 'spendUsd' ? formatUsd(parseUsd(trigger.threshold)) : formatNumber(trigger.threshold)} (${trigger.period})`
      return `${fill(UI_TEXT.accounts.swapNotice, { provider: event.provider, account: this.label(event.account), previous: this.label(event.previousAccount), threshold })} ${fill(UI_TEXT.accounts.coldCache, { cost: formatUsd(parseUsd(event.coldCacheUsd)) })}`
    }
    if (event.type === 'spread')
      return `${UI_TEXT.accounts.spreadEvent}: ${event.provider} · ${this.label(event.account)}`
    const url = accountUsageUrl(this.port, event.provider)
    return `${accountStopText(event)} ${url}`
  }

  private current(): string {
    const state = this.state
    if (!state?.currentAccount) throw new Error(UI_TEXT.accounts.unavailable)
    return `${UI_TEXT.accounts.current}: ${state.provider} · ${this.label(state.currentAccount)}`
  }

  private async refresh(isCurrent: () => boolean): Promise<void> {
    const revision = this.noticeRevision
    let state: AccountsState
    try {
      state = parseState(await this.port.read(this.sessionId))
    } catch {
      throw new Error(UI_TEXT.accounts.unavailable)
    }
    if (!isCurrent() || (this.state !== undefined && state.provider !== this.state.provider))
      throw new Error(UI_TEXT.accounts.unavailable)
    // A notification committed while the read was held is newer authority.
    if (revision !== this.noticeRevision) return
    const isChanged =
      this.state !== undefined && JSON.stringify(this.state) !== JSON.stringify(state)
    this.state = state
    if (isChanged) this.onChange()
  }

  public async start(): Promise<void> {
    const receive = (event: AccountEvent | AccountsState) => {
      if (this.isDisposed) return
      const parsed = accountEventSchema.safeParse(event)
      const snapshot = accountsReplySchema.safeParse(event)
      let notice: AccountEvent | AccountsState | undefined
      if (parsed.success) notice = parsed.data
      else if (snapshot.success && snapshot.data.type === 'accounts/state') notice = snapshot.data
      if (notice === undefined) return
      if (this.state === undefined) {
        this.earlyNotices.push(notice)
        return
      }
      if (this.state.provider !== notice.provider) return
      if (notice.type === 'accounts/state') {
        this.noticeRevision += 1
        this.state = notice
        this.onChange()
        return
      }
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
        await this.refresh(isCurrent)
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
    const revision = this.noticeRevision
    await this.own(async (isCurrent) => {
      if (this.state === undefined) throw new Error(UI_TEXT.accounts.unavailable)
      if (revision !== this.noticeRevision) throw new Error(UI_TEXT.accounts.unavailable)
      if (!accountIdSchema.safeParse(account).success)
        throw new Error(UI_TEXT.accounts.invalidAccount)
      await this.refresh(isCurrent)
      if (revision !== this.noticeRevision) throw new Error(UI_TEXT.accounts.unavailable)
      if (this.state.accounts.every((row) => row.id !== account))
        throw new Error(UI_TEXT.accounts.invalidAccount)
      const canAdopt = () => isCurrent() && revision === this.noticeRevision && canCommit()
      let state: AccountsState
      try {
        state = parseState(await this.port.use(this.sessionId, account, canAdopt))
      } catch {
        throw new Error(UI_TEXT.accounts.unavailable)
      }
      if (!isCurrent() || !canCommit()) throw new Error(UI_TEXT.accounts.unavailable)
      if (state.provider !== this.state.provider || state.currentAccount !== account)
        throw new Error(UI_TEXT.accounts.unavailable)
      if (revision !== this.noticeRevision) {
        if (this.state.currentAccount !== account) throw new Error(UI_TEXT.accounts.unavailable)
        return
      }
      this.noticeRevision += 1
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
    if (action !== 'thresholds' && (account !== undefined || !['list', 'current'].includes(action)))
      throw new Error(UI_TEXT.accounts.invalidAccount)
    await this.own(async (isCurrent) => {
      await this.refresh(isCurrent)
    })
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
