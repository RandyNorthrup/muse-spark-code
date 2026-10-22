// Slash commands use the existing ACP prompt/available-commands paths. The host
// supplies its preview/composer UI bridge; no private ACP method is invented.
//
// This module never imports the ACP SDK: it ships in the lazy sharing bundle
// as well as the engine, and a second bundled copy of the SDK's RequestError
// would fail the engine serializer's `instanceof` check and misreport every
// sharing refusal as an internal error. Failures cross the lazy boundary as
// AcpSharingFailure (read with isAcpSharingFailure, never `instanceof`); the
// engine owns the single RequestError constructor and maps them there.
import { UI_TEXT } from '../shared/constants'
import { sharingHelp } from '../shared/featureCatalog'
import {
  parseSharingSlash,
  localArgumentError,
  SharingArgumentError,
} from '../runtime/sharing/args'
import type { SharingCommands, SharingUi, SharingResult } from '../runtime/sharing/commands'

export interface AcpSharingContext {
  readonly cwd: string
  readonly sessionId: string
  /** False after cancel, close, reload, backend exit, or replacement of this prompt. */
  readonly isActive: () => boolean
  readonly signal: AbortSignal
}

/** Runtime binding M118-X-ACP; ordinary execution/paid approvals cannot settle this UI. */
export interface AcpSharingPort {
  commands(): { name: string; description: string; input: { hint: string } | null }[]
  execute(text: string, context: AcpSharingContext): Promise<string>
}

/**
JSON-RPC codes a sharing failure carries for the engine to map. Named so
no magic number crosses the lazy bundle boundary in either direction.
*/
export const SHARING_FAILURE_CODES = {
  invalidRequest: -32_600,
  invalidParams: -32_602,
  internalError: -32_603,
} as const

/** JSON-RPC code an AcpSharingFailure carries for the engine to map. */
export type SharingFailureCode = (typeof SHARING_FAILURE_CODES)[keyof typeof SHARING_FAILURE_CODES]

/**
A sharing failure with the JSON-RPC code it deserves. The class is bundled
twice (engine and lazy sharing runtime), so readers use
isAcpSharingFailure, never `instanceof`.
*/
export class AcpSharingFailure extends Error {
  public constructor(
    public readonly code: SharingFailureCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'AcpSharingFailure'
  }
}

/** Whether a failure crossed from the sharing adapter, whichever bundle copy threw it. */
export function isAcpSharingFailure(error: unknown): error is AcpSharingFailure {
  return (
    error instanceof Error &&
    error.name === 'AcpSharingFailure' &&
    'code' in error &&
    (Object.values(SHARING_FAILURE_CODES) as readonly unknown[]).includes(error.code)
  )
}

export function sharingResultText(result: SharingResult): string {
  switch (result.kind) {
    case 'saved': {
      return `${UI_TEXT.promptSave}: ${result.prompt.title} (${result.prompt.id})`
    }
    case 'listed': {
      return [
        UI_TEXT.promptLibrary,
        ...result.prompts.map((p) =>
          [
            `${p.scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace}: ${p.title} (${p.id})`,
            `${UI_TEXT.promptTags}: ${p.tags.join(', ')}`,
            `${UI_TEXT.promptVariables}: ${p.variables.map((v) => v.name).join(', ')}`,
            ...(p.untrusted ? [UI_TEXT.promptUntrusted] : []),
          ].join('\n'),
        ),
      ].join('\n\n')
    }
    case 'inserted': {
      return UI_TEXT.promptInsert
    }
    case 'prepared': {
      return `${UI_TEXT.promptInsert}\n\n${result.text}`
    }
    case 'shared': {
      return UI_TEXT.shareConfirm
    }
    case 'cancelled': {
      return result.message ?? UI_TEXT.shareCancelled
    }
  }
}

export function acpSharingCommands(): ReturnType<AcpSharingPort['commands']> {
  return [
    { name: 'help', description: UI_TEXT.promptLibrary, input: null },
    {
      name: 'share',
      description: UI_TEXT.shareChat,
      input: { hint: 'chat [--mode full|conversation] [--format md|html|json]' },
    },
    {
      name: 'prompt',
      description: UI_TEXT.promptLibrary,
      input: { hint: 'save|list|use|share' },
    },
  ]
}

/**
A sharing refusal the product defines, read at use time so the installed
language is the one shown. Anything else is not a refusal: caller-owned
input fails as invalid params where it is classified, and an unexpected
failure becomes a sanitized internal fault with no raw text (the SDK copies
ordinary exception messages into error.data.details).
*/
/**
A sharing refusal the product defines, for every surface that reports one:
the ACP adapter, the headless `share`/`prompts` commands and the editor
boundary all keep the same sentences. Anything else is an unexpected fault.
*/
export function sharingRefusal(message: string): string | undefined {
  const refusals = [
    UI_TEXT.exportNothing,
    UI_TEXT.exportHistoryUnavailable,
    UI_TEXT.exportWaitForTurn,
    UI_TEXT.shareConfidential,
    UI_TEXT.shareCancelled,
    UI_TEXT.shareRangeInvalid,
    UI_TEXT.shareTooLarge,
    UI_TEXT.shareAttachmentUnavailable,
    UI_TEXT.sharePreviewExpired,
    UI_TEXT.promptFileInvalid,
    UI_TEXT.promptLimits,
    UI_TEXT.promptStoreDamaged,
    UI_TEXT.promptStoreBusy,
    UI_TEXT.promptWorkspaceRequired,
    UI_TEXT.promptUntrusted,
  ]
  return refusals.includes(message) || message.startsWith(`${UI_TEXT.promptVariables}:`)
    ? message
    : undefined
}

export function createAcpSharing(
  commands: SharingCommands,
  uiFor: (context: AcpSharingContext) => SharingUi,
): AcpSharingPort {
  return {
    commands: acpSharingCommands,
    execute: async (text, context) => {
      if (text.trim() === '/help') {
        context.signal.throwIfAborted()
        return sharingHelp()
      }
      let parsed: ReturnType<typeof parseSharingSlash>
      try {
        parsed = parseSharingSlash(text, context.sessionId)
      } catch (error: unknown) {
        // The parser's own error already names the caller's argument in the
        // installed language; anything else (Node's option diagnostics, a
        // JSON quote failure) becomes the product's unknown-argument reason.
        // Either way the original fault rides along as `cause`, never on
        // the wire.
        throw new AcpSharingFailure(
          SHARING_FAILURE_CODES.invalidParams,
          error instanceof SharingArgumentError ? error.message : localArgumentError(text).message,
          { cause: error },
        )
      }
      if (parsed === undefined)
        throw new AcpSharingFailure(
          SHARING_FAILURE_CODES.invalidParams,
          localArgumentError(text).message,
        )
      if (
        parsed.command.command === 'share' &&
        parsed.command.request.target === 'chat' &&
        parsed.command.request.sessionId !== context.sessionId
      ) {
        throw new AcpSharingFailure(
          SHARING_FAILURE_CODES.invalidParams,
          localArgumentError(parsed.command.request.sessionId).message,
        )
      }
      try {
        const result = await commands.execute(parsed.command, {
          ...context,
          ui: uiFor(context),
          readBody: () => Promise.resolve(parsed.body ?? ''),
        })
        return sharingResultText(result)
      } catch (error: unknown) {
        // Cancellation stays cancellable: the engine maps it, never an error.
        if (context.signal.aborted) throw error
        if (error instanceof SharingArgumentError)
          throw new AcpSharingFailure(SHARING_FAILURE_CODES.invalidParams, error.message, {
            cause: error,
          })
        if (error instanceof Error) {
          const refusal = sharingRefusal(error.message)
          if (refusal !== undefined)
            throw new AcpSharingFailure(SHARING_FAILURE_CODES.invalidRequest, refusal, {
              cause: error,
            })
        }
        // Anything unrecognized stays an internal fault with the fixed
        // could-not-complete reason in place of paths, prompt text or raw
        // diagnostics: a failed export or an unreadable prompt library is
        // not a prompt-file format error. The original fault rides along as
        // `cause` (never on the wire: the engine maps only the fixed
        // message), so the log the reason points at can name it.
        throw new AcpSharingFailure(SHARING_FAILURE_CODES.internalError, UI_TEXT.actionFailed, {
          cause: error,
        })
      }
    },
  }
}
