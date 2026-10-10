// Slash commands use the existing ACP prompt/available-commands paths. The host
// supplies its preview/composer UI bridge; no private ACP method is invented.
import { RequestError } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import { sharingHelp } from '../shared/featureCatalog'
import { parseSharingSlash, localArgumentError } from '../runtime/sharing/args'
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

function resultText(result: SharingResult): string {
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
 * A sharing refusal the product defines, read at use time so the installed
 * language is the one shown. Anything else rethrows: only known refusal
 * sentences may cross the ACP boundary, never an unexpected failure.
 */
function sharingRefusal(message: string): RequestError | undefined {
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
    ? RequestError.invalidRequest(undefined, message)
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
        // Bad flags and unknown actions are invalid params, with their reason.
        throw RequestError.invalidParams(
          undefined,
          error instanceof Error ? error.message : UI_TEXT.promptFileInvalid,
        )
      }
      if (parsed === undefined)
        throw RequestError.invalidParams(undefined, localArgumentError(text).message)
      if (
        parsed.command.command === 'share' &&
        parsed.command.request.target === 'chat' &&
        parsed.command.request.sessionId !== context.sessionId
      ) {
        throw RequestError.invalidParams(
          undefined,
          localArgumentError(parsed.command.request.sessionId).message,
        )
      }
      try {
        const result = await commands.execute(parsed.command, {
          ...context,
          ui: uiFor(context),
          readBody: () => Promise.resolve(parsed.body ?? ''),
        })
        return resultText(result)
      } catch (error: unknown) {
        // An empty conversation shares nothing: the CLI's sentence reaches
        // the client as its own message, never -32603 internal error.
        if (error instanceof RequestError) throw error
        if (error instanceof Error) {
          const refusal = sharingRefusal(error.message)
          if (refusal !== undefined) throw refusal
        }
        throw error
      }
    },
  }
}
