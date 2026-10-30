import {
  developerRequestSchema,
  type DeveloperRequest,
  type DeveloperReply,
} from '../../shared/developerOptions'
import { handleDeveloperRequest } from '../../core/developer/surfaces'
import type { DeveloperOptions } from '../../core/developer/developerOptions'
import { UI_TEXT } from '../../shared/constants'

/** H calls this before its ordinary CLI parser; only identifiers are accepted.
Credentials still enter through auth's standard input, never these args. */
export function parseDeveloperCommand(args: readonly string[]): DeveloperRequest | undefined {
  const [command, action, first, second, extra] = args
  if (command !== 'developer') return undefined
  if (extra !== undefined) throw new SyntaxError(UI_TEXT.developer.commandUsage)
  if (action === undefined) {
    if (first !== undefined || second !== undefined)
      throw new SyntaxError(UI_TEXT.developer.commandUsage)
    return { type: 'developer/unlock' }
  }
  if (first === undefined && second === undefined) {
    switch (action) {
      case 'status': {
        return { type: 'developer/read' }
      }
      case 'enable': {
        return { type: 'developer/setMultiple', enabled: true }
      }
      case 'disable': {
        return { type: 'developer/setMultiple', enabled: false }
      }
      case 'reset': {
        return { type: 'developer/reset' }
      }
    }
  }
  // Bad identifiers are misuse, not a crash: the entry answers the usage
  // with exit 2 before any store or state work.
  if (action === 'add' && first !== undefined && second !== undefined) {
    const parsed = developerRequestSchema.safeParse({
      type: 'developer/addProfile',
      provider: first,
      account: second,
    })
    if (!parsed.success) throw new SyntaxError(UI_TEXT.developer.commandUsage)
    return parsed.data
  }
  if (action === 'remove' && first !== undefined && second === undefined) {
    const parsed = developerRequestSchema.safeParse({
      type: 'developer/removeProfile',
      id: first,
    })
    if (!parsed.success) throw new SyntaxError(UI_TEXT.developer.commandUsage)
    return parsed.data
  }
  throw new SyntaxError(UI_TEXT.developer.commandUsage)
}

export async function runDeveloperCommand(
  owner: DeveloperOptions,
  args: readonly string[],
  clientId: string,
): Promise<DeveloperReply> {
  const request = parseDeveloperCommand(args)
  return request === undefined
    ? { type: 'developer/error', code: 'invalidRequest' }
    : await handleDeveloperRequest(
        owner,
        { id: clientId, isLocal: true, kind: 'terminal' },
        request,
      )
}
