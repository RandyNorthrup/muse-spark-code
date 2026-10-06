import { randomUUID } from 'node:crypto'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { ChatShareRelease } from '../../core/sharing/shareRelease'
import { chatShareDestination } from '../../core/sharing/destinations'
import { confineWorkspacePath } from '../../core/workspacePath'
import { canonicalPath } from '../canonicalPath'
import { writeFileAtomically } from '../fsAtomic'
import { PROMPT_FILE_MODE, SHARE_PREFERENCES_KEY, UI_TEXT } from '../../shared/constants'
import { shareRequestSchema, type SharePrivacyPort } from '../../shared/share'
import type { ChatShareSource } from '../../core/sharing/chatShare'

export interface ChatSharingDeps {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly state: {
    get(key: string): unknown
    update(key: string, value: unknown): PromiseLike<void>
  }
  readonly currentSessionId: () => string | undefined
  readonly read: (sessionId: string | undefined, exportedAt: string) => Promise<ChatShareSource>
  readonly privacy: SharePrivacyPort
  readonly isConfidentialWorkspace: () => boolean | undefined
  readonly refreshSecrets: () => Promise<void>
}
const preferencesSchema = z.strictObject({
  mode: z.enum(['full', 'conversation']),
  format: z.enum(['md', 'html', 'json']),
})

/** One release coordinator per surface; all sinks receive only its exact preview bytes. */
export function createChatSharing(deps: ChatSharingDeps) {
  const root = deps.workspaceRoot ?? deps.storageRoot
  let previewSession: string | undefined
  const policy = () => {
    if (previewSession !== undefined && deps.currentSessionId() !== previewSession)
      throw new Error(UI_TEXT.sharePreviewExpired)
    return deps.isConfidentialWorkspace()
  }
  const release = new ChatShareRelease({
    privacy: deps.privacy,
    isConfidentialWorkspace: policy,
    newPreviewId: randomUUID,
    prepare: chatShareDestination({
      copy: async (content, admit) => {
        admit()
        await vscode.env.clipboard.writeText(content)
      },
      chooseFile: async (fileName) => {
        const selected = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(root, fileName)),
        })
        return selected?.fsPath
      },
      browserFile: (fileName) =>
        Promise.resolve(path.join(deps.storageRoot, `${randomUUID()}-${fileName}`)),
      writeFile: async (file, content, admit) => {
        const allowedRoot = file.startsWith(`${deps.storageRoot}${path.sep}`)
          ? deps.storageRoot
          : root
        await deps.refreshSecrets()
        const checked = await confineWorkspacePath(allowedRoot, file, process.platform, {
          realPath: (value) => canonicalPath(value, { followsBrokenLinks: true }),
        })
        if (!checked.ok) throw new Error(UI_TEXT.sharePreviewExpired)
        admit()
        await writeFileAtomically(checked.checkedAbsolute, content, {
          mode: PROMPT_FILE_MODE,
          expectedCanonicalPath: checked.checkedAbsolute,
          beforeCommit: admit,
          assertCanWrite: admit,
          sleep: (ms) =>
            new Promise((resolve) => {
              setTimeout(resolve, ms)
            }),
        })
      },
      openBrowser: async (file, admit) => {
        admit()
        await vscode.env.openExternal(vscode.Uri.file(file))
      },
    }),
  })
  return {
    invalidate: () => {
      release.invalidate()
    },
    handle: async (action: string, input: unknown): Promise<unknown> => {
      switch (action) {
        case 'chatContext': {
          if (policy() !== false) throw new Error(UI_TEXT.shareConfidential)
          const source = await deps.read(undefined, new Date().toISOString())
          const remembered = preferencesSchema.safeParse(deps.state.get(SHARE_PREFERENCES_KEY))
          return {
            sessionId: source.sessionId,
            messages: source.items
              .filter((item) => item.kind === 'userMessage' || item.kind === 'agentMessage')
              .map((item) => ({ id: item.itemId, label: item.text ?? item.kind })),
            attachments:
              source.attachments?.map((attachment) => ({
                id: attachment.id,
                name: attachment.name ?? attachment.id,
              })) ?? [],
            initialMode: remembered.success ? remembered.data.mode : 'conversation',
            initialFormat: remembered.success ? remembered.data.format : 'md',
          }
        }
        case 'chatPreview': {
          const request = shareRequestSchema.parse(input)
          if (request.target !== 'chat') throw new Error(UI_TEXT.shareRangeInvalid)
          previewSession = request.sessionId
          await deps.refreshSecrets()
          return await release.prepareFromHistory(
            () => deps.read(undefined, new Date().toISOString()),
            request,
          )
        }
        case 'chatConfirm': {
          await deps.refreshSecrets()
          return await release.confirm(input)
        }
        case 'remember': {
          await deps.state.update(SHARE_PREFERENCES_KEY, preferencesSchema.parse(input))
          return undefined
        }
        case 'invalidate': {
          release.invalidate()
          previewSession = undefined
          return undefined
        }
        default: {
          throw new Error(UI_TEXT.sharePreviewExpired)
        }
      }
    },
  }
}
