// The ACP agent's account services entry (M108/W): the store, the policy,
// the developer owner and the headless ports live in dist/runtimeAccounts.js
// and load only on the first accounts, developer or keyed headless command,
// so ACP startup and argument parsing never carry them (PLAN.md D6).
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import {
  createRuntimeAccountServices,
  type RuntimeAccountServices,
  type RuntimeAccountServicesInput,
} from './runtimeServices'

export type { RuntimeAccountServices, RuntimeAccountServicesInput } from './runtimeServices'
import { runDeveloperCommand } from '../developer/developerCommand'
import { developerStatusText } from '../../core/developer/surfaces'

export function createRuntimeAccountServicesForLocale(
  table: UiText,
  locale: string,
  input: RuntimeAccountServicesInput,
): RuntimeAccountServices {
  setUiText(table, locale)
  return createRuntimeAccountServices(input)
}

export interface TerminalDeveloperCommandDeps {
  readonly readLine: (prompt: string) => Promise<string>
  readonly print: (line: string) => void
}

/** The terminal `developer` command: real store, real confirmation, rendered. */
export async function runTerminalDeveloperCommand(
  table: UiText,
  locale: string,
  input: RuntimeAccountServicesInput,
  owner: TerminalDeveloperCommandDeps,
  args: readonly string[],
  clientId: string,
): Promise<{ readonly text: string; readonly exitCode: number }> {
  setUiText(table, locale)
  const services = createRuntimeAccountServices(input)
  const developer = await services.developer(owner)
  const reply = await runDeveloperCommand(developer, args, clientId)
  return reply.type === 'developer/error'
    ? { text: UI_TEXT.developer[reply.code], exitCode: 1 }
    : { text: developerStatusText(reply), exitCode: 0 }
}

export { runAccountsCommand, runAccountAuthSet } from './accountsCommand'
