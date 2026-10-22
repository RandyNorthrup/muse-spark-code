// Terminal and editor entry points use the same runtime host. Only the
// browser's authorize URL and translated status reach the command output.
import {
  ChatGptSignIn,
  ChatGptSignInError,
  chatGptRecordSchema,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import type { SignInMethod } from '../acp/agent'
import { createRuntimeChatGptHost, type RuntimeChatGptOptions } from './chatGptHost'
import { CHATGPT_NEW_ACCOUNT_FLAG, UI_TEXT } from '../shared/constants'
import { failureCodeNames } from '../core/networkFailure'
import { chatGptCatalog, chatGptFailureText } from '../core/providers/subscriptions/registry'
import type { ProviderEntry } from '../core/providers/providersFile'
export { runtimeSubscriptionClient } from './subscriptionProviderCommands'
import {
  runSubscriptionProviderCommand,
  subscriptionAuthenticationMethods,
  subscriptionCommandDeps,
  type SubscriptionAuthBinding,
  type SubscriptionCommandBinding,
  type SubscriptionCommandClient,
  type SubscriptionCommandDeps,
  type SubscriptionCommandDepsOptions,
  type SubscriptionLocalStatus,
} from './subscriptionProviderCommands'

/** `add-new-account` is `providers add chatgpt --new-account`: a new registration. */
export type ChatGptProviderAction = 'add' | 'add-new-account' | 'remove' | 'status'
export type ChatGptLocalStatus = SubscriptionLocalStatus

/** Translated command text; failure codes never contain service text. */
export interface ChatGptCommandText {
  beforeSignIn(): string
  alreadyAdded(): string
  status(state: ChatGptLocalStatus): string
  failure(code: ChatGptSignInError['code'], reason?: string): string
}

export type ChatGptProviderCommandDeps = SubscriptionCommandDeps<ChatGptHostPort, ChatGptSignIn>

async function readChatGptState(host: ChatGptHostPort): Promise<SubscriptionLocalStatus> {
  const stored = await host.readRecord()
  if (stored === undefined) return 'signed-out'
  const parsed = chatGptRecordSchema.safeParse(stored)
  if (!parsed.success) throw new ChatGptSignInError('grant-unreadable')
  return parsed.data.expiresAt > host.now() ? 'signed-in' : 'expired'
}

function chatGptFailureTextOf(error: unknown): string {
  return error instanceof ChatGptSignInError
    ? chatGptFailureText(error.code, error.reason)
    : chatGptFailureText('request-failed', failureCodeNames(error))
}

function chatGptBinding(
  createHost: () => Promise<ChatGptHostPort>,
  send: typeof fetch,
): SubscriptionCommandBinding<ChatGptHostPort, ChatGptSignIn> {
  return {
    id: 'chatgpt',
    // The issued client lives in the registration: no per-call client.
    createHost: (_client: SubscriptionCommandClient) => createHost(),
    createSignIn: (host) =>
      new ChatGptSignIn({
        ...host,
        // The outer grant lock remains held through configuration and rollback.
        // Re-entering the nonreentrant OS listener here would deadlock.
        withRefreshLock: (work) => work(),
      }),
    signIn: (signIn, { isNewAccount }) => signIn.signIn({ isNewAccount }),
    remove: (signIn) => signIn.remove(),
    readState: readChatGptState,
    catalog: async (signIn) => {
      const { slugs } = await chatGptCatalog(signIn, send)
      return slugs
    },
    entry: (models): ProviderEntry => ({
      id: 'chatgpt',
      preset: 'chatgpt',
      address: 'https://api.openai.com',
      format: 'responses',
      auth: 'subscription',
      models: [...models],
    }),
    fileError: (kind, reason) =>
      new ChatGptSignInError(
        kind === 'unreadable' ? 'providers-file-unreadable' : 'providers-file-unwritable',
        reason,
      ),
    alreadyAdded: () => new ChatGptSignInError('already-added'),
    text: {
      beforeSignIn: () => chatGptCommandText().beforeSignIn(),
      alreadyAdded: () => chatGptCommandText().alreadyAdded(),
      status: (state) => chatGptCommandText().status(state),
    },
    failureText: chatGptFailureTextOf,
  }
}

export async function runChatGptProviderCommand(
  action: ChatGptProviderAction,
  deps: ChatGptProviderCommandDeps,
): Promise<number> {
  return await runSubscriptionProviderCommand(
    action === 'add-new-account' ? 'add' : action,
    deps.io,
    deps.binding,
    action === 'add-new-account' ? { isNewAccount: true } : undefined,
  )
}

/** A ChatGPT failure's own sentence, or undefined for an error that is not one. */
export function chatGptFailureOf(error: unknown): string | undefined {
  return error instanceof ChatGptSignInError
    ? chatGptFailureText(error.code, error.reason)
    : undefined
}

/** Live language reads; no provider error or store text is ever interpolated. */
export function chatGptCommandText(): ChatGptCommandText {
  return {
    beforeSignIn: () => UI_TEXT.acpChatGpt.notice,
    alreadyAdded: () => UI_TEXT.acpChatGpt.alreadyAdded,
    status: (state) => UI_TEXT.acpChatGpt.states[state],
    failure: chatGptFailureText,
  }
}

/** Production terminal and ACP composition for the ChatGPT binding. */
export function runtimeChatGptCommandDeps(
  options: RuntimeChatGptOptions & SubscriptionCommandDepsOptions,
): ChatGptProviderCommandDeps {
  return subscriptionCommandDeps(
    options,
    chatGptBinding(() => createRuntimeChatGptHost(options), options.fetch),
  )
}

/**
The stored grant's account identity: the verified account hash where the
sign-in captured one, else the whole record. A refused `add-new-account`
leaves the old grant byte-identical, so an unchanged identity fails.
*/
function chatGptGrantIdentity(record: unknown): string | undefined {
  const parsed = chatGptRecordSchema.safeParse(record)
  return parsed.success ? (parsed.data.accountIdHash ?? JSON.stringify(parsed.data)) : undefined
}

/** ACP terminal auth methods run the exact same CLI actions in every editor. */
export function chatGptAuthenticationMethods(
  createHost: () => Promise<ChatGptHostPort>,
): SignInMethod[] {
  const binding: SubscriptionAuthBinding<ChatGptHostPort> = {
    createHost,
    actions: [
      {
        id: 'chatgpt-add',
        name: UI_TEXT.acpChatGpt.actions.add,
        description: UI_TEXT.acpChatGpt.notice,
        args: ['providers', 'add', 'chatgpt'],
        kind: 'add',
      },
      {
        id: 'chatgpt-add-new-account',
        name: UI_TEXT.acpChatGpt.actions['add-new-account'],
        description: UI_TEXT.acpChatGpt.notice,
        args: ['providers', 'add', 'chatgpt', CHATGPT_NEW_ACCOUNT_FLAG],
        kind: 'add',
        baseline: true,
      },
      {
        id: 'chatgpt-remove',
        name: UI_TEXT.acpChatGpt.actions.remove,
        description: UI_TEXT.acpChatGpt.notice,
        args: ['providers', 'remove', 'chatgpt'],
        kind: 'remove',
      },
      {
        id: 'chatgpt-status',
        name: UI_TEXT.acpChatGpt.actions.status,
        description: UI_TEXT.acpChatGpt.notice,
        args: ['providers', 'status', 'chatgpt'],
        kind: 'status',
      },
    ],
    checkRecord: (stored) => {
      if (!chatGptRecordSchema.safeParse(stored).success)
        throw new ChatGptSignInError('grant-unreadable')
    },
    grantIdentity: chatGptGrantIdentity,
    missing: () => new ChatGptSignInError('not-signed-in'),
    present: () => new ChatGptSignInError('still-signed-in'),
    unchanged: () => new ChatGptSignInError('already-added'),
    failureText: chatGptFailureTextOf,
  }
  return subscriptionAuthenticationMethods(binding)
}
