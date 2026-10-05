// Terminal and editor entry points use the same runtime host. Only the
// browser's authorize URL and translated status reach the command output.
import {
  ChatGptSignIn,
  ChatGptSignInError,
  chatGptRecordSchema,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

export type ChatGptProviderAction = 'add' | 'remove' | 'status'
export type ChatGptLocalStatus = 'signed-in' | 'expired' | 'signed-out'

/** Exact terminal grammar: credentials and extra arguments are never accepted. */
export function parseChatGptProviderAction(
  argv: readonly string[],
): ChatGptProviderAction | undefined {
  const [command, action, provider, ...rest] = argv
  if (command !== 'providers' || provider !== 'chatgpt' || rest.length > 0) return
  switch (action) {
    case 'add':
    case 'remove':
    case 'status': {
      return action
    }
    default: {
      return undefined
    }
  }
}

/** Lane 0/W supply translated text; failure codes never contain service text. */
export interface ChatGptCommandText {
  beforeSignIn(): string
  alreadyAdded(): string
  status(state: ChatGptLocalStatus): string
  failure(code: ChatGptSignInError['code']): string
}

export interface ChatGptProviderCommandDeps {
  createHost(): Promise<ChatGptHostPort>
  /** W owns the nonsecret providers-file/catalogue wiring; add commits
   * atomically before success. Both calls run under the grant's process lock. */
  readonly providers: {
    add(): Promise<void>
    remove(): Promise<void>
  }
  readonly text: ChatGptCommandText
  print(line: string): void
  printError(line: string): void
}

export async function runChatGptProviderCommand(
  action: ChatGptProviderAction,
  deps: ChatGptProviderCommandDeps,
): Promise<number> {
  try {
    if (action === 'add') deps.print(deps.text.beforeSignIn())
    const host = await deps.createHost()
    if (action === 'status') {
      const state = await host.withRefreshLock(async (): Promise<ChatGptLocalStatus> => {
        const stored = await host.readRecord()
        if (stored === undefined) return 'signed-out'
        const parsed = chatGptRecordSchema.safeParse(stored)
        if (!parsed.success) throw new ChatGptSignInError('invalid-token')
        return parsed.data.expiresAt > host.now() ? 'signed-in' : 'expired'
      })
      deps.print(deps.text.status(state))
      return state === 'signed-out' ? 1 : 0
    }
    return await host.withRefreshLock(async () => {
      const signIn = new ChatGptSignIn({
        ...host,
        // The outer grant lock remains held through configuration and rollback.
        // Re-entering the nonreentrant OS listener here would deadlock.
        withRefreshLock: (work) => work(),
      })
      if (action === 'remove') {
        try {
          await signIn.remove()
        } finally {
          await deps.providers.remove()
        }
        deps.print(fill(UI_TEXT.acpProviderRemoved, { id: 'chatgpt' }))
        return 0
      }
      // Never overwrite an unrevoked grant, including an expired one.
      if ((await host.readRecord()) !== undefined) {
        deps.printError(deps.text.alreadyAdded())
        return 1
      }
      await signIn.signIn()
      try {
        await deps.providers.add()
      } catch (error) {
        try {
          await signIn.remove()
        } catch {
          /* The failed setup still fails; revocation attempted and the local record deleted. */
        }
        throw error
      }
      deps.print(fill(UI_TEXT.acpProviderAdded, { id: 'chatgpt' }))
      return 0
    })
  } catch (error) {
    deps.printError(
      deps.text.failure(error instanceof ChatGptSignInError ? error.code : 'request-failed'),
    )
    return 1
  }
}
