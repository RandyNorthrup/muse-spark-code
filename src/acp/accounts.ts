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
import { slashCommandText } from '../shared/mentions'
import {
  accountStopText,
  accountEventText,
  accountUsageUrl,
  isAccountSwitchRefusedError,
  isInvalidProvidersFileError,
  type AccountUsagePort,
} from './accountText'

export { accountErrorText, isAccountSwitchRefusedError } from './accountText'

type AccountsState = Extract<AccountsReply, { type: 'accounts/state' }>
export interface AccountsSessionPort extends AccountUsagePort {
  readonly supportsNextRequestSelection?: boolean
  read(sessionId: string): Promise<AccountsState>
  /** Check canCommit immediately before the owner's synchronous selection
   * transaction. Never adopt after a session release or a newer operation. */
  use(sessionId: string, account: string, canCommit: () => boolean): Promise<AccountsState>
  /** Publish a fresh state from the live account store on metadata changes,
   * as well as notices from the same owner's committed adoption transaction. */
  subscribe(sessionId: string, listener: (event: AccountEvent | AccountsState) => void): () => void
}

/** U's panel dispatcher, also used by the authenticated companion bridge.
 * M104 owns origin/permission/envelope checks; this is the inner payload port.
 * @unwired M104 companion bridge for accounts */
export interface AccountsPanelPort {
  dispatch(request: AccountsRequest): Promise<AccountsReply>
  subscribe(listener: (reply: AccountsReply) => void): () => void
}
/** The companion's validated panel skin over the inner payload port.
 * @unwired M104 companion bridge for accounts */
export function companionAccountsPanel(port: AccountsPanelPort): AccountsPanelPort {
  return {
    async dispatch(request) {
      const parsed = accountsRequestSchema.safeParse(request)
      if (!parsed.success) return { type: 'accounts/error', code: 'invalidAccount' }
      try {
        const reply = accountsReplySchema.safeParse(await port.dispatch(parsed.data))
        return reply.success ? reply.data : { type: 'accounts/error', code: 'unavailable' }
      } catch (error: unknown) {
        return {
          type: 'accounts/error',
          code: isInvalidProvidersFileError(error) ? 'providersInvalid' : 'unavailable',
        }
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
    if (event.type !== 'stop') return accountEventText(event, this.state?.accounts ?? [])
    // The runtime owner has no bundled usage page (D88.5): the stop still
    // names the blocked account and its reset instead of becoming a failure.
    try {
      const url = accountUsageUrl(this.port, event.provider)
      return `${accountStopText(event, this.label(event.account))} ${url}`
    } catch {
      return accountStopText(event, this.label(event.account))
    }
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
    } catch (error: unknown) {
      // A refused providers file keeps its brand through the refresh: the
      // agent maps it to the honest sentence at the request boundary.
      if (isInvalidProvidersFileError(error)) throw error
      throw new Error(UI_TEXT.accounts.unavailable, { cause: error })
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

  public get supportsNextRequestSelection(): boolean {
    return this.port.supportsNextRequestSelection === true
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
    } catch (error: unknown) {
      // The branded providers-file refusal still drops the session's
      // accounts here and continues, like any other failed adoption:
      // ordinary sessions never depend on accounts.
      if (isInvalidProvidersFileError(error)) throw error
      throw new Error(UI_TEXT.accounts.unavailable, { cause: error })
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
      } catch (error: unknown) {
        // The owner refused adoption with the session's stay-put text; a
        // refused providers file keeps its brand for the honest sentence.
        // Any other failure stays a generic unavailable, never raw error
        // text. The brand (not `instanceof`) survives the bundle boundary
        // between the runtime producer and this consumer.
        if (isAccountSwitchRefusedError(error)) throw error
        if (isInvalidProvidersFileError(error)) throw error
        throw new Error(UI_TEXT.accounts.unavailable, { cause: error })
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

  public async command(sent: string, canCommit: () => boolean): Promise<string | undefined> {
    const text = slashCommandText(sent)
    if (!/^\/accounts(?:\s|$)/.test(text)) return
    if (this.isDisposed || this.state === undefined) throw new Error(UI_TEXT.accounts.unavailable)
    const [, action = 'list', account, ...rest] = text.split(/\s+/)
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
