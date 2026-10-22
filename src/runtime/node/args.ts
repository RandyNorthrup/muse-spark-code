import { parseArgs } from 'node:util'
import {
  NODE_AUDIT_MAX_BYTES,
  NODE_AUDIT_RETENTION_DAYS,
  NODE_DEFAULT_PORT,
  NODE_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import { nodeConfigSchema, type NodeConfig } from '../../shared/node'

export type NodeAction = 'init' | 'serve' | 'status' | 'stop' | 'lock' | 'unlock' | 'wipe'
export interface NodeCommand {
  readonly command: 'node'
  readonly action: NodeAction | 'help'
  readonly dataRoot: string | undefined
  readonly config: NodeConfig | undefined
  readonly all: boolean
  readonly confirmWipe: boolean
}

/** No key, passphrase, bearer or code can enter an argument or environment option. */
export function parseNodeArgs(argv: readonly string[]): NodeCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      'data-root': { type: 'string' },
      'workspace-root': { type: 'string' },
      name: { type: 'string', multiple: true },
      label: { type: 'string' },
      listen: { type: 'string' },
      port: { type: 'string' },
      all: { type: 'boolean' },
      'confirm-wipe': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [action] = positionals
  if (values['data-root'] === '' || positionals.length > 1)
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  if (action === undefined || values.help === true) {
    return {
      command: 'node',
      action: 'help',
      dataRoot: values['data-root'],
      config: undefined,
      all: false,
      confirmWipe: false,
    }
  }
  if (
    action !== 'init' &&
    action !== 'serve' &&
    action !== 'status' &&
    action !== 'stop' &&
    action !== 'lock' &&
    action !== 'unlock' &&
    action !== 'wipe'
  ) {
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  }
  if (
    (action !== 'stop' && values.all === true) ||
    (action !== 'wipe' && values['confirm-wipe'] === true)
  )
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  if (
    action !== 'init' &&
    [values['workspace-root'], values.name, values.label, values.listen, values.port].some(
      (value) => value !== undefined,
    )
  ) {
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  }
  if (values.port !== undefined && (values.listen === undefined || !/^\d+$/u.test(values.port)))
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  const config =
    action === 'init'
      ? nodeConfigSchema.parse({
          v: NODE_PROTOCOL_VERSION,
          mode: 'home',
          label: values.label,
          browserNames: values.name,
          listener:
            values.listen === undefined
              ? null
              : {
                  address: values.listen,
                  port: values.port === undefined ? NODE_DEFAULT_PORT : Number(values.port),
                },
          workspaceRoot: values['workspace-root'],
          audit: { maxBytes: NODE_AUDIT_MAX_BYTES, retentionDays: NODE_AUDIT_RETENTION_DAYS },
        })
      : undefined
  return {
    command: 'node',
    action,
    dataRoot: values['data-root'],
    config,
    all: values.all === true,
    confirmWipe: values['confirm-wipe'] === true,
  }
}
