// Slash commands use the existing ACP prompt/available-commands paths. The host
// supplies its preview/composer UI bridge; no private ACP method is invented.
import { UI_TEXT } from '../shared/constants'
import { parseSharingSlash, localArgumentError } from '../runtime/sharing/args'
import {
  type SharingCommands,
  type SharingUi,
  type SharingResult,
} from '../runtime/sharing/commands'

export interface AcpSharingContext {
  readonly cwd: string
  readonly sessionId: string
  /** False after cancel, close, reload, backend exit, or replacement of this prompt. */
  readonly isActive: () => boolean
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
      return UI_TEXT.shareCancelled
    }
  }
}

export function createAcpSharing(
  commands: SharingCommands,
  uiFor: (context: AcpSharingContext) => SharingUi,
): AcpSharingPort {
  return {
    commands: () => [
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
    ],
    execute: async (text, context) => {
      const parsed = parseSharingSlash(text, context.sessionId)
      if (parsed === undefined) throw localArgumentError(text)
      if (
        parsed.command.command === 'share' &&
        parsed.command.request.target === 'chat' &&
        parsed.command.request.sessionId !== context.sessionId
      ) {
        throw localArgumentError(parsed.command.request.sessionId)
      }
      const result = await commands.execute(parsed.command, {
        ...context,
        ui: uiFor(context),
        readBody: () => Promise.resolve(parsed.body ?? ''),
      })
      return resultText(result)
    },
  }
}
