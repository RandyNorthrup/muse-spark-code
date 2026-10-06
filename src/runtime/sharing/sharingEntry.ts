import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { userInfo } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'
import * as z from 'zod/mini'
import { PromptStore } from '../../core/prompts/promptStore'
import { createChatSharePrivacy } from '../../core/sharing/privacy'
import { buildChatShare, renderChatShare, type ChatShareSource } from '../../core/sharing/chatShare'
import { buildPromptShare } from '../../core/sharing/promptShare'
import { confineWorkspacePath } from '../../core/workspacePath'
import { canonicalPath } from '../../host/canonicalPath'
import { writeFileAtomically } from '../../host/fsAtomic'
import { agentDataFolder, type DataFolderInput } from '../dataFolder'
import { SharingCommands, runSharingCommand, type SharePreview, type SharingUi } from './commands'
import type { SharingCommand } from './args'
import { createAcpSharing, acpSharingCommands, type AcpSharingPort } from '../../acp/sharing'
import {
  UI_TEXT,
  PROMPT_LIMITS,
  PROMPT_FILE_MODE,
  PROMPT_STDIN_TIMEOUT_MS,
  SETTING_DEFAULTS,
  EXEC_EXIT,
} from '../../shared/constants'
import { redactSecrets } from '../../shared/redact'
import { withoutCredentials } from '../credentialVariables'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export interface RuntimeSharingPorts {
  readonly folders: DataFolderInput
  readonly registeredSecrets?: () => Promise<readonly string[]>
  readonly read: (cwd: string, sessionId: string, exportedAt: string) => Promise<ChatShareSource>
}
const policySchema = z.object({ 'museSpark.confidentialWorkspace': z.optional(z.boolean()) })
/** Read the existing workspace setting afresh at each admission; unavailable policy refuses. */
export function runtimeSharingConfidential(cwd: string): boolean | undefined {
  try {
    return (
      policySchema.parse(
        JSON.parse(readFileSync(path.join(cwd, '.vscode', 'settings.json'), 'utf8')),
      )['museSpark.confidentialWorkspace'] ?? SETTING_DEFAULTS.confidentialWorkspace
    )
  } catch (error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? SETTING_DEFAULTS.confidentialWorkspace
      : undefined
  }
}

function markers(content: string) {
  return Array.from(
    content.matchAll(/\[(?:redacted(?: path| account)?|home|user|path)\]/g),
    (match) => ({ start: match.index, end: match.index + match[0].length }),
  )
}

/** Fixed local OS adapters; only scrubbed share bytes reach their stdin. */
async function localProgram(
  file: string,
  args: readonly string[],
  signal: AbortSignal,
  text?: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Fixed platform clipboard/browser binaries and fixed switches; a confined file is one argument, scrubbed text is stdin, no shell or credential environment (M118, PLAN §8).
    const child = spawn(file, [...args], {
      env: withoutCredentials(process.env),
      signal,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    const failed = () => {
      reject(new Error(UI_TEXT.shareCancelled))
    }
    child.on('error', failed)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else failed()
    })
    child.stdin.on('error', failed)
    child.stdin.end(text ?? '')
  })
}

function commandsFor(ports: RuntimeSharingPorts): SharingCommands {
  const dataRoot = agentDataFolder(ports.folders)
  const storeFor = (cwd: string) => new PromptStore(dataRoot, cwd)
  return new SharingCommands({
    folders: ports.folders,
    now: () => new Date().toISOString(),
    storageFor: (folders) => storeFor(path.dirname(path.dirname(folders.workspace))),
    io: { realPath: (file) => canonicalPath(file, { followsBrokenLinks: true }) },
    isConfidentialWorkspace: runtimeSharingConfidential,
    renderPreview: async (cwd, request, exportedAt) => {
      const registered = (await ports.registeredSecrets?.()) ?? []
      const privacy = createChatSharePrivacy({
        workspaceRoots: [cwd],
        home: ports.folders.homeDir,
        userName: userInfo().username,
        redactRegisteredSecrets: (text) => redactSecrets(text, registered),
      })
      if (request.target === 'chat') {
        const doc = buildChatShare(
          await ports.read(cwd, request.sessionId, exportedAt),
          request,
          privacy,
        )
        const content = renderChatShare(doc, request.format)
        return { document: doc, content, redactions: markers(content) }
      }
      if (request.source.kind !== 'saved') throw new Error(UI_TEXT.promptFileInvalid)
      const source = request.source
      const prompts = await storeFor(cwd).list(source.scope)
      const prompt = prompts.find((p) => p.id === source.promptId)
      if (prompt === undefined) throw new Error(UI_TEXT.promptFileInvalid)
      const rendered = buildPromptShare(prompt, request, exportedAt, privacy)
      return { ...rendered, redactions: markers(rendered.content) }
    },
    release: async (preview, out, root, signal) => {
      const registered = (await ports.registeredSecrets?.()) ?? []
      const admit = () => {
        signal.throwIfAborted()
        const clean = JSON.stringify(preview.document, (_key, value: unknown) =>
          typeof value === 'string' ? redactSecrets(value, registered) : value,
        )
        if (clean !== JSON.stringify(preview.document)) throw new Error(UI_TEXT.sharePreviewExpired)
        if (runtimeSharingConfidential(root) !== false) throw new Error(UI_TEXT.shareConfidential)
      }
      if (preview.request.destination === 'copy') {
        admit()
        let program = 'xclip'
        let args = ['-selection', 'clipboard']
        if (process.platform === 'darwin') {
          program = 'pbcopy'
          args = []
        } else if (process.platform === 'win32') {
          program = 'powershell.exe'
          args = ['-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())']
        }
        await localProgram(program, args, signal, preview.content)
        return
      }
      const destinationFile =
        preview.request.destination === 'browser'
          ? path.join(root, `muse-share-${randomUUID()}.html`)
          : out
      if (destinationFile === undefined) throw new Error(UI_TEXT.shareCancelled)
      const checked = await confineWorkspacePath(root, destinationFile, process.platform, {
        realPath: (file) => canonicalPath(file, { followsBrokenLinks: true }),
      })
      if (!checked.ok) throw new Error(UI_TEXT.shareCancelled)
      admit()
      await writeFileAtomically(checked.absolute, preview.content, {
        mode: PROMPT_FILE_MODE,
        expectedCanonicalPath: checked.absolute,
        beforeCommit: admit,
        assertCanWrite: admit,
        sleep: (ms) =>
          new Promise((resolve) => {
            setTimeout(resolve, ms)
          }),
      })
      if (preview.request.destination !== 'browser') {
        return
      }

      admit()
      let program = 'xdg-open'
      if (process.platform === 'darwin') program = 'open'
      else if (process.platform === 'win32') program = 'explorer.exe'
      await localProgram(program, [checked.absolute], signal)
    },
  })
}

async function question(title: string, signal: AbortSignal) {
  if (!process.stdin.isTTY) return
  const input = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await input.question(`${title}: `, { signal })
  } finally {
    input.close()
  }
}

function terminalUi(): SharingUi {
  return {
    showPreview: (preview, signal) => {
      signal.throwIfAborted()
      process.stdout.write(`${preview.content}\n`)
      return Promise.resolve()
    },
    ...(process.stdin.isTTY && {
      confirmShare: async (preview: SharePreview, signal: AbortSignal) =>
        (await question(`${UI_TEXT.shareConfirm} (y/N)`, signal)) === 'y'
          ? { step: 'confirmed', previewId: preview.previewId, request: preview.request }
          : undefined,
    }),
    preparePrompt: async (prompt, signal) => {
      process.stdout.write(
        `${UI_TEXT.promptUntrusted}\n${prompt.body}\n${UI_TEXT.promptVariables}: ${prompt.variables.map((variable) => variable.name).join(', ')}\n`,
      )
      if ((await question(`${UI_TEXT.promptInsert} (y/N)`, signal)) !== 'y') return
      let text = prompt.body
      for (const variable of prompt.variables) {
        const value = await question(`${UI_TEXT.promptVariables}: ${variable.name}`, signal)
        if (value === undefined) return
        text = text.replaceAll(`{{${variable.name}}}`, () => value)
      }
      if (text.length > PROMPT_LIMITS.body) throw new Error(UI_TEXT.promptLimits)
      process.stdout.write(`${text}\n`)
      return (await question(`${UI_TEXT.promptInsert} (y/N)`, signal)) === 'y' ? text : undefined
    },
  }
}

function cancelRead() {
  process.stdin.destroy(new Error(UI_TEXT.shareCancelled))
}

export async function runRuntimeSharing(
  command: SharingCommand,
  ports: RuntimeSharingPorts,
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  const controller = new AbortController()
  const stop = () => {
    controller.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const result = await runSharingCommand(command, commandsFor(ports), {
      cwd: process.cwd(),
      isActive: () => !controller.signal.aborted,
      signal: controller.signal,
      ui: terminalUi(),
      readBody: async () => {
        controller.signal.addEventListener('abort', cancelRead, { once: true })
        const deadline = setTimeout(stop, PROMPT_STDIN_TIMEOUT_MS)
        let text = ''
        let bytes = 0
        const decoder = new TextDecoder('utf-8', { fatal: true })
        try {
          for await (const chunk of process.stdin) {
            controller.signal.throwIfAborted()
            if (!(chunk instanceof Buffer)) throw new Error(UI_TEXT.promptFileInvalid)
            bytes += chunk.byteLength
            if (bytes > PROMPT_LIMITS.fileBytes) throw new Error(UI_TEXT.promptLimits)
            text += decoder.decode(chunk, { stream: true })
          }
          return text + decoder.decode()
        } finally {
          clearTimeout(deadline)
          controller.signal.removeEventListener('abort', cancelRead)
        }
      },
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return result.exitCode
  } catch (error: unknown) {
    const known = [
      UI_TEXT.shareConfidential,
      UI_TEXT.shareCancelled,
      UI_TEXT.sharePreviewExpired,
      UI_TEXT.promptLimits,
    ]
    const message =
      error instanceof Error && known.includes(error.message)
        ? error.message
        : UI_TEXT.promptFileInvalid
    process.stderr.write(`${message}\n`)
    return EXEC_EXIT.denied
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

/** ACP returns the exact preview through its existing text response; release awaits M104's final-action UI. */
export function runtimeAcpSharing(
  ports: RuntimeSharingPorts,
  table: UiText,
  locale: string,
): AcpSharingPort {
  setUiText(table, locale)
  const commands = commandsFor(ports)
  const portFor = (show: (text: string) => void) =>
    createAcpSharing(commands, () => ({
      showPreview: (preview, signal) => {
        signal.throwIfAborted()
        show(preview.content)
        return Promise.resolve()
      },
    }))
  return {
    commands: acpSharingCommands,
    execute: async (text, context) => {
      let preview: string | undefined
      const result = await portFor((shown) => {
        preview = shown
      }).execute(text, context)
      return preview === undefined ? result : `${preview}\n\n${result}`
    },
  }
}
