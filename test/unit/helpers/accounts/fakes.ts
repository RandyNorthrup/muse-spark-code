import { Usd as PortUsd } from '../../../../src/shared/usd'
// Fakes for the other M108 lanes. These normalized replies are local test
// contracts, never evidence of a vendor's wire shape.
import {
  accountEventSchema,
  type AccountEvent,
  type AccountJournalReader,
  type AccountUsageQuery,
  type AccountUsageTotals,
} from '../../../../src/shared/accounts'
import { deviceAccountHeadroomSchema } from '../../../../src/shared/devices'

export class FakeAccountClock {
  readonly now = (): number => this.time
  constructor(private time: number) {}
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Invalid fake-clock advance')
    this.time += ms
  }
}

export interface FakeAccountUsage extends AccountUsageTotals {
  readonly provider: string
  readonly account: string
  readonly time: string
}

export function emptyAccountUsage() {
  return {
    settledUsd: PortUsd.from(0).toAmount(),
    reservedUsd: PortUsd.from(0).toAmount(),
    uncertainUsd: PortUsd.from(0).toAmount(),
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
  } satisfies AccountUsageTotals
}

export class FakeAccountJournal implements AccountJournalReader {
  private readonly usage: FakeAccountUsage[] = []
  readonly events: AccountEvent[] = []
  append(row: FakeAccountUsage): void {
    this.usage.push({ ...row })
  }
  record(raw: unknown): void {
    this.events.push(accountEventSchema.parse(raw))
  }
  read(query: AccountUsageQuery): AccountUsageTotals {
    const totals = emptyAccountUsage()
    const start = Date.parse(query.start)
    const end = Date.parse(query.end)
    for (const row of this.usage) {
      if (
        row.provider !== query.provider ||
        row.account !== query.account ||
        Date.parse(row.time) < start ||
        Date.parse(row.time) >= end
      )
        continue
      totals.settledUsd = PortUsd.from(totals.settledUsd)
        .add(PortUsd.from(row.settledUsd))
        .toAmount()
      totals.reservedUsd = PortUsd.from(totals.reservedUsd)
        .add(PortUsd.from(row.reservedUsd))
        .toAmount()
      totals.uncertainUsd = PortUsd.from(totals.uncertainUsd)
        .add(PortUsd.from(row.uncertainUsd))
        .toAmount()
      totals.inputTokens += row.inputTokens
      totals.outputTokens += row.outputTokens
      totals.requests += row.requests
    }
    return totals
  }
}

export interface FakeAccountLimit {
  readonly requests: number
  readonly windowMs: number
  readonly retryAfterMs: number
}
interface Window {
  used: number
  resetAt: number
  retryAt: number
}
export type FakeAccountReply =
  | { readonly status: 200; readonly account: string; readonly remainingRequests: number }
  | { readonly status: 429; readonly account: string; readonly retryAt: number }

export class FakeAccountProvider {
  private readonly windows = new Map<string, Window>()
  readonly calls: { account: string; status: number; wasDuringRetry: boolean }[] = []
  constructor(
    private readonly limits: ReadonlyMap<string, FakeAccountLimit>,
    private readonly now: () => number,
  ) {}
  request(account: string): FakeAccountReply {
    const limit = this.limits.get(account)
    if (limit === undefined) throw new Error('Unknown fake account')
    const now = this.now()
    let window = this.windows.get(account)
    if (window === undefined) {
      window = { used: 0, resetAt: now + limit.windowMs, retryAt: 0 }
      this.windows.set(account, window)
    }
    const wasDuringRetry = now < window.retryAt
    if (!wasDuringRetry && now >= window.resetAt) {
      window.used = 0
      window.resetAt = now + limit.windowMs
    }
    if (wasDuringRetry || window.used >= limit.requests) {
      window.retryAt = Math.max(window.retryAt, window.resetAt, now + limit.retryAfterMs)
      this.calls.push({ account, status: 429, wasDuringRetry })
      return { status: 429, account, retryAt: window.retryAt }
    }
    window.used += 1
    this.calls.push({ account, status: 200, wasDuringRetry })
    return { status: 200, account, remainingRequests: limit.requests - window.used }
  }
}

// Its receiver owns this dependency. Confirmation state never enters its offer.
export class FakeAccountDevice {
  constructor(private readonly canAdmit: (provider: string) => boolean) {}
  offer(raw: unknown): unknown {
    return deviceAccountHeadroomSchema.parse(raw)
  }
  receive(provider: string): boolean {
    return this.canAdmit(provider)
  }
}
