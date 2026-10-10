// Pure account arguments; credentials and command runners load on first use.
import { parseArgs } from 'node:util'
import {
  accountIdSchema,
  accountSchema,
  accountThresholdsSchema,
  type Account,
  type AccountThresholds,
} from '../../shared/accounts'

export interface AccountTarget {
  readonly provider: string
  readonly account: string
}
export type AccountsCommand =
  | { readonly action: 'list'; readonly provider: string }
  | { readonly action: 'add'; readonly provider: string; readonly account: Account }
  | { readonly action: 'remove'; readonly provider: string; readonly account: string }
  | { readonly action: 'order'; readonly provider: string; readonly accounts: readonly string[] }
  | {
      readonly action: 'thresholds'
      readonly provider: string
      readonly account: string
      readonly thresholds: AccountThresholds
    }

export function parseAccountsCommand(argv: readonly string[]): AccountsCommand | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        provider: { type: 'string' },
        account: { type: 'string' },
        label: { type: 'string' },
        'limit-group': { type: 'string' },
        thresholds: { type: 'string' },
      },
    })
    const provider = accountIdSchema.parse(values.provider)
    const [action, ...ids] = positionals
    let allowed = ['provider']
    switch (action) {
      case 'add': {
        allowed = ['provider', 'account', 'label', 'limit-group']
        break
      }
      case 'thresholds': {
        allowed = ['provider', 'account', 'thresholds']
        break
      }
      case 'remove': {
        allowed = ['provider', 'account']
        break
      }
      default: {
        break
      }
    }
    if (Object.keys(values).some((key) => !allowed.includes(key))) return
    if (action === 'order')
      return { action, provider, accounts: ids.map((id) => accountIdSchema.parse(id)) }
    if (ids.length > 0) return
    if (action === 'list') return { action, provider }
    const account = accountIdSchema.parse(values.account)
    if (action === 'remove') return { action, provider, account }
    if (action === 'thresholds') {
      const data: unknown = JSON.parse(values.thresholds ?? '')
      return { action, provider, account, thresholds: accountThresholdsSchema.parse(data) }
    }
    if (action === 'add')
      return {
        action,
        provider,
        account: accountSchema.parse({
          id: account,
          label: values.label,
          order: 0,
          thresholds: {},
          ...(values['limit-group'] !== undefined && { limitGroup: values['limit-group'] }),
        }),
      }
    return
  } catch {
    return
  }
}
