import * as z from 'zod/mini'
import { type McpTool } from '../../mcp'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type VaultExecService } from './service'
import { vaultRunSchema } from './schema'
import { VAULT_EXEC_PARAMETERS } from './toolSchema'

const listSchema = z.strictObject({})
const requestSchema = z.strictObject({
  name: z.string().check(z.regex(/^[a-z][a-z0-9-]{0,47}$/u), z.maxLength(VAULT_LIMITS.name)),
})

/** B pins the requester and U/H owns the UI; no approval answer is a tool parameter. */
export function vaultExecTools(
  service: VaultExecService,
  assertCanRun: () => void,
  text: {
    readonly list: string
    readonly request: string
    readonly run: string
    readonly refused: string
  },
): readonly McpTool[] {
  const safely = async (work: () => Promise<string>) => {
    try {
      return await work()
    } catch {
      throw new Error(text.refused)
    }
  }
  return [
    {
      name: 'secret_list',
      description: text.list,
      inputSchema: VAULT_EXEC_PARAMETERS.list,
      call: async (args, signal) => {
        return await safely(async () => {
          listSchema.parse(args)
          return await service.list(signal)
        })
      },
    },
    {
      name: 'secret_request',
      description: text.request,
      inputSchema: VAULT_EXEC_PARAMETERS.request,
      call: async (args, signal) => {
        return await safely(async () => {
          const request = requestSchema.parse(args)
          return await service.requestMissing(request.name, signal)
        })
      },
    },
    {
      name: 'vault_run',
      description: text.run,
      inputSchema: VAULT_EXEC_PARAMETERS.run,
      call: async (args, signal) => {
        return await safely(async () => {
          const run = vaultRunSchema.parse(args)
          const result = await service.run(run, signal, assertCanRun)
          signal.throwIfAborted()
          if (result.exitCode === null) throw new Error(text.refused)
          return JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            isTimedOut: result.isTimedOut,
            isCancelled: result.isCancelled,
          })
        })
      },
    },
  ]
}
