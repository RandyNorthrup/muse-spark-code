// Terminal and editor entry points use the same runtime host. Only the
// browser's authorize URL, or the device code and address, and translated
// status reach the command output.
import type { GrokHostPort } from '../core/providers/subscriptions/grok'
// The sign-in core stays in dist/subscriptions.js; this bundle reads it
// through subscriptionsEntry (one `instanceof` across the boundary).
import { GrokSignIn, GrokSignInError, grokRecordSchema } from '../host/backend/subscriptionsEntry'
import type { SignInMethod } from '../acp/agent'
import { createRuntimeGrokHost, type RuntimeGrokOptions } from './grokHost'
import {
  GROK_CLIENT_ID_FLAG,
  GROK_DEVICE_FLAG,
  GROK_SCOPES_FLAG,
  UI_TEXT,
} from '../shared/constants'
import { failureCodeNames } from '../core/networkFailure'
import { grokFailureText, grokModels } from '../core/providers/subscriptions/registry'
import type { ProviderEntry } from '../core/providers/providersFile'
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

/** `providers add grok` takes the device flow and the OAuth client configuration. */
export interface GrokProviderAction {
  readonly action: 'add' | 'remove' | 'status'
  readonly isDeviceFlow?: boolean
  readonly clientId?: string
  readonly scopes?: string
}
export type GrokLocalStatus = SubscriptionLocalStatus

/** Translated command text; failure codes never contain service text. */
export interface GrokCommandText {
  beforeSignIn(isDeviceFlow: boolean): string
  alreadyAdded(): string
  status(state: GrokLocalStatus): string
  failure(code: GrokSignInError['code'], reason?: string): string
}

export type GrokProviderCommandDeps = SubscriptionCommandDeps<GrokHostPort, GrokSignIn>

async function readGrokState(host: GrokHostPort): Promise<SubscriptionLocalStatus> {
  const stored = await host.readRecord()
  if (stored === undefined) return 'signed-out'
  const parsed = grokRecordSchema.safeParse(stored)
  if (!parsed.success) throw new GrokSignInError('grant-unreadable')
  return parsed.data.expiresAt > host.now() ? 'signed-in' : 'expired'
}

function grokFailureTextOf(error: unknown): string {
  return error instanceof GrokSignInError
    ? grokFailureText(error.code, error.reason)
    : grokFailureText('request-failed', failureCodeNames(error))
}

function grokBinding(
  createHost: (client: SubscriptionCommandClient) => GrokHostPort,
  send: typeof fetch,
): SubscriptionCommandBinding<GrokHostPort, GrokSignIn> {
  return {
    id: 'grok',
    createHost: (client) => createHost(client),
    createSignIn: (host) =>
      new GrokSignIn({
        ...host,
        // The outer grant lock remains held through configuration and rollback.
        // Re-entering the nonreentrant OS listener here would deadlock.
        withRefreshLock: (work) => work(),
      }),
    signIn: (signIn, { isDeviceFlow }) =>
      isDeviceFlow ? signIn.signInWithDevice() : signIn.signIn(),
    remove: (signIn) => signIn.remove(),
    readState: readGrokState,
    catalog: (signIn) => grokModels(signIn, send),
    entry: (models): ProviderEntry => ({
      id: 'grok',
      preset: 'grok',
      address: 'https://api.x.ai',
      format: 'responses',
      auth: 'subscription',
      models: [...models],
    }),
    fileError: (kind, reason) =>
      new GrokSignInError(
        kind === 'unreadable' ? 'providers-file-unreadable' : 'providers-file-unwritable',
        reason,
      ),
    alreadyAdded: () => new GrokSignInError('already-added'),
    text: {
      beforeSignIn: (isDeviceFlow) => grokCommandText().beforeSignIn(isDeviceFlow),
      alreadyAdded: () => grokCommandText().alreadyAdded(),
      status: (state) => grokCommandText().status(state),
    },
    failureText: grokFailureTextOf,
  }
}

export async function runGrokProviderCommand(
  action: GrokProviderAction,
  deps: GrokProviderCommandDeps,
): Promise<number> {
  return await runSubscriptionProviderCommand(action.action, deps.io, deps.binding, {
    isDeviceFlow: action.isDeviceFlow ?? false,
    client: { clientId: action.clientId, scopes: action.scopes },
  })
}

/** A Grok failure's own sentence, or undefined for an error that is not one. */
export function grokFailureOf(error: unknown): string | undefined {
  return error instanceof GrokSignInError ? grokFailureText(error.code, error.reason) : undefined
}

/** Live language reads; no provider error or store text is ever interpolated. */
export function grokCommandText(): GrokCommandText {
  return {
    beforeSignIn: (isDeviceFlow) =>
      isDeviceFlow ? UI_TEXT.acpGrok.deviceNotice : UI_TEXT.acpGrok.notice,
    alreadyAdded: () => UI_TEXT.acpGrok.alreadyAdded,
    status: (state) => UI_TEXT.acpGrok.states[state],
    failure: grokFailureText,
  }
}

/**
Production terminal and ACP composition, using the shared atomic nonsecret
file. The OAuth client travels with each command, not with the composition.
*/
export function runtimeGrokCommandDeps(
  options: Omit<RuntimeGrokOptions, 'clientId' | 'scopes'> & SubscriptionCommandDepsOptions,
): GrokProviderCommandDeps {
  return subscriptionCommandDeps(
    options,
    grokBinding(
      (client) =>
        createRuntimeGrokHost({
          secrets: options.secrets,
          fetch: options.fetch,
          clientId: client.clientId,
          scopes: client.scopes,
          openBrowser: options.openBrowser,
          callbackText: options.callbackText,
          ...(options.presentDeviceCode !== undefined && {
            presentDeviceCode: options.presentDeviceCode,
          }),
          ...(options.signal !== undefined && { signal: options.signal }),
          ...(options.lock !== undefined && { lock: options.lock }),
        }),
      options.fetch,
    ),
  )
}

/**
The stored grant's account identity: the verified account hash where the
sign-in captured one, else the whole record. Read where a baselined add
must change the grant.
*/
function grokGrantIdentity(record: unknown): string | undefined {
  const parsed = grokRecordSchema.safeParse(record)
  return parsed.success ? (parsed.data.accountIdHash ?? JSON.stringify(parsed.data)) : undefined
}

/** ACP terminal auth methods run the exact same CLI actions in every editor. */
export function grokAuthenticationMethods(
  createHost: () => Promise<GrokHostPort> | GrokHostPort,
  client: { clientId?: string; scopes?: string },
): SignInMethod[] {
  const extra: string[] = []
  if (client.clientId !== undefined) extra.push(GROK_CLIENT_ID_FLAG, client.clientId)
  if (client.scopes !== undefined) extra.push(GROK_SCOPES_FLAG, client.scopes)
  const binding: SubscriptionAuthBinding<GrokHostPort> = {
    createHost,
    actions: [
      {
        id: 'grok-add',
        name: UI_TEXT.acpGrok.actions.add,
        description: UI_TEXT.acpGrok.notice,
        args: ['providers', 'add', 'grok', ...extra],
        kind: 'add',
      },
      {
        id: 'grok-add-device',
        name: UI_TEXT.acpGrok.actions['add-device'],
        description: UI_TEXT.acpGrok.deviceNotice,
        args: ['providers', 'add', 'grok', GROK_DEVICE_FLAG, ...extra],
        kind: 'add',
      },
      {
        id: 'grok-remove',
        name: UI_TEXT.acpGrok.actions.remove,
        description: UI_TEXT.acpGrok.notice,
        args: ['providers', 'remove', 'grok'],
        kind: 'remove',
      },
      {
        id: 'grok-status',
        name: UI_TEXT.acpGrok.actions.status,
        description: UI_TEXT.acpGrok.notice,
        args: ['providers', 'status', 'grok'],
        kind: 'status',
      },
    ],
    checkRecord: (stored) => {
      if (!grokRecordSchema.safeParse(stored).success) throw new GrokSignInError('grant-unreadable')
    },
    grantIdentity: grokGrantIdentity,
    missing: () => new GrokSignInError('not-signed-in'),
    present: () => new GrokSignInError('still-signed-in'),
    unchanged: () => new GrokSignInError('already-added'),
    failureText: grokFailureTextOf,
  }
  return subscriptionAuthenticationMethods(binding)
}
