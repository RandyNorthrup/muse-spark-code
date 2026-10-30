// Pure account arguments; credentials and command runners load on first use.
import { parseArgs } from 'node:util'
import {
  accountDeviceSchema,
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
  | {
      readonly action: 'place'
      readonly provider: string
      readonly account: string
      readonly device: string
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
        device: { type: 'string' },
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
      case 'place': {
        allowed = ['provider', 'device']
        break
      }
      default: {
        break
      }
    }
    if (Object.keys(values).some((key) => !allowed.includes(key))) return
    if (action === 'order')
      return { action, provider, accounts: ids.map((id) => accountIdSchema.parse(id)) }
    if (action === 'place') {
      if (ids.length !== 1 || ids[0] === undefined) return
      return {
        action,
        provider,
        account: accountIdSchema.parse(ids[0]),
        device: accountDeviceSchema.parse(values.device),
      }
    }
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
  } catch (error) {
    // CLI arguments are boundary input: usage errors, malformed ids and
    // malformed JSON read as no command. Anything else keeps its kind.
    if (error instanceof TypeError) return undefined
    if (error instanceof SyntaxError) return undefined
    if (error instanceof Error && error.name === '$ZodError') return undefined
    throw error
  }
}
