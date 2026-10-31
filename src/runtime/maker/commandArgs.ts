import { parseArgs } from 'node:util'
import { UI_TEXT } from '../../shared/constants'

export interface MakerCommand {
  readonly command: 'maker'
  readonly action: 'hardware' | 'machines' | 'stop-machine' | 'panel'
  readonly operation?: string
  readonly id?: string
  readonly cwd?: string
  readonly reason?: string
  readonly registration?: string
  readonly keyStdin: boolean
  readonly all: boolean
  readonly trusted: boolean
}
export function parseMakerCommand(argv: readonly string[]): MakerCommand | undefined {
  const [word, ...rest] = argv
  // A bare `panel` is the MHP host's (M104 lane B, D84); the maker's page is `machines panel`.
  const isPanel = word === 'machines' && rest[0] === 'panel'
  const action = isPanel ? 'panel' : word
  if (
    action !== 'hardware' &&
    action !== 'machines' &&
    action !== 'stop-machine' &&
    action !== 'panel'
  )
    return undefined
  const { values, positionals } = parseArgs({
    args: isPanel ? rest.slice(1) : rest,
    strict: true,
    allowPositionals: true,
    options: {
      cwd: { type: 'string' },
      reason: { type: 'string' },
      registration: { type: 'string' },
      'key-stdin': { type: 'boolean' },
      all: { type: 'boolean' },
      'trust-workspace': { type: 'boolean' },
    },
  })
  const [operation, id] = positionals
  if (
    action === 'hardware' &&
    (positionals.length !== 1 || !['enable', 'disable', 'status'].includes(operation ?? ''))
  )
    throw new Error(UI_TEXT.makerTitle)
  if (
    action === 'machines' &&
    (!['add', 'list', 'remove'].includes(operation ?? '') ||
      positionals.length !== (operation === 'remove' ? 2 : 1))
  )
    throw new Error(UI_TEXT.makerDevicesTitle)
  if (action === 'machines' && operation === 'add' && values.registration === undefined)
    throw new Error(UI_TEXT.makerAddMachine)
  if (
    action === 'stop-machine' &&
    (positionals.length > 1 || (values.all === true && positionals.length > 0))
  )
    throw new Error(UI_TEXT.makerPhysicalStopRequired)
  if (action === 'panel' && positionals.length > 0) throw new Error(UI_TEXT.makerTitle)
  if (values['key-stdin'] === true && (action !== 'machines' || operation !== 'add'))
    throw new Error(UI_TEXT.makerAddMachine)
  return {
    command: 'maker',
    action,
    ...(operation !== undefined && { operation }),
    ...(id !== undefined && { id }),
    ...(values.cwd !== undefined && { cwd: values.cwd }),
    ...(values.reason !== undefined && { reason: values.reason }),
    ...(values.registration !== undefined && { registration: values.registration }),
    keyStdin: values['key-stdin'] === true,
    all: values.all === true,
    trusted: values['trust-workspace'] === true,
  }
}
