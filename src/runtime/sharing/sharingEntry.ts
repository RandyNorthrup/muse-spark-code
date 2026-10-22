import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { userInfo } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { handoffResourceFile } from '../../core/resources/launcher'
import { isResourcePaused } from '../../core/resources/launch'
import { PromptStore } from '../../core/prompts/promptStore'
import { usePrompt } from '../../core/prompts/promptLibrary'
import { createChatSharePrivacy } from '../../core/sharing/privacy'
import { buildChatShare, renderChatShare, type ChatShareSource } from '../../core/sharing/chatShare'
import { buildPromptShare } from '../../core/sharing/promptShare'
import { confineWorkspacePath } from '../../core/workspacePath'
import { canonicalPath } from '../../host/canonicalPath'
import { writeFileAtomically } from '../../host/fsAtomic'
import { agentDataFolder, type DataFolderInput } from '../dataFolder'
import { SharingCommands, runSharingCommand, type SharePreview, type SharingUi } from './commands'
import { SharingArgumentError, type SharingCommand } from './args'
import {
  createAcpSharing,
  acpSharingCommands,
  sharingRefusal,
  sharingResultText,
  type AcpSharingPort,
} from '../../acp/sharing'
import { internalFaultForLog } from '../../core/backends/musecode/logText'
import type { Logger } from '../../host/logger'
import {
  UI_TEXT,
  PROMPT_FILE_MODE,
  PROMPT_STDIN_TIMEOUT_MS,
  EXEC_EXIT,
} from '../../shared/constants'
import { redactSecrets } from '../../shared/redact'
import { withoutCredentials } from '../credentialVariables'
import { environmentValue, windowsPowerShell } from '../../core/execGuard'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export interface RuntimeSharingPorts {
  readonly folders: DataFolderInput
  readonly registeredSecrets?: () => Promise<readonly string[]>
  readonly read: (cwd: string, sessionId: string, exportedAt: string) => Promise<ChatShareSource>
}
import { runtimeSharingConfidential } from './confidential'

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
  workspaceRoot: string,
  text?: string,
  env: NodeJS.ProcessEnv = withoutCredentials(process.env),
): Promise<void> {
  // Fixed platform clipboard/browser binaries and switches; a confined file is one
  // argument, scrubbed text is stdin, no shell or credential environment (M118).
  // Bare adapter names never resolve inside the shared workspace.
  try {
    await handoffResourceFile(file, args, {
      env,
      signal,
      workspaceRoot,
      ...(text !== undefined && { input: text }),
    })
  } catch (error: unknown) {
    if (isResourcePaused(error)) throw error
    throw new Error(UI_TEXT.shareCancelled, { cause: error })
  }
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
        if (process.platform === 'win32') {
          // `%SystemRoot%`'s Windows PowerShell, never PATH's, with its own
          // module path (the guarded layer's rule for every 5.1 child).
          const systemRoot = environmentValue(process.env, process.platform, 'SystemRoot')
          if (systemRoot === undefined || !path.win32.isAbsolute(systemRoot))
            throw new Error(UI_TEXT.shareCancelled)
          const powershell = windowsPowerShell(systemRoot)
          await localProgram(
            powershell.file,
            ['-NoProfile', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
            signal,
            root,
            preview.content,
            powershell.env,
          )
          return
        }
        const isMac = process.platform === 'darwin'
        await localProgram(
          isMac ? 'pbcopy' : 'xclip',
          isMac ? [] : ['-selection', 'clipboard'],
          signal,
          root,
          preview.content,
        )
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
      await writeFileAtomically(checked.checkedAbsolute, preview.content, {
        mode: PROMPT_FILE_MODE,
        expectedCanonicalPath: checked.checkedAbsolute,
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
      await localProgram(program, [checked.checkedAbsolute], signal, root)
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
    // A TTY stdin left flowing keeps the event loop alive after the answer,
    // so the process would never exit. Pause it deterministically here; the
    // next question's interface resumes it.
    process.stdin.pause()
  }
}

/** A terminal `(y/N)` answer: y or yes in any case, with surrounding space ignored. */
export function isAffirmativeAnswer(answer: string | undefined): boolean {
  if (answer === undefined) return false
  const normalized = answer.trim().toLowerCase()
  return normalized === 'y' || normalized === 'yes'
}

function terminalUi(
  scripted?: {
    readonly vars: ReadonlyMap<string, string>
    readonly confirmed: boolean
  },
  isSilent = false,
): SharingUi {
  return {
    showPreview: (preview, signal) => {
      signal.throwIfAborted()
      // JSON mode keeps stdout to the single result value: the structured
      // result already carries the preview (Codex on PR #213).
      if (!isSilent) process.stdout.write(`${preview.content}\n`)
      return Promise.resolve()
    },
    ...(process.stdin.isTTY && {
      confirmShare: async (preview: SharePreview, signal: AbortSignal) =>
        isAffirmativeAnswer(await question(`${UI_TEXT.shareConfirm} (y/N)`, signal))
          ? { step: 'confirmed', previewId: preview.previewId, request: preview.request }
          : undefined,
    }),
    preparePrompt: async (prompt, signal) => {
      // Only an imported prompt is untrusted; a prompt the person saved
      // themselves must not be called imported. The single confirmation
      // happens after the variables, at the review below.
      if (!isSilent) {
        if (prompt.untrusted) process.stdout.write(`${UI_TEXT.promptUntrusted}\n`)
        process.stdout.write(
          `${prompt.body}\n${UI_TEXT.promptVariables}: ${prompt.variables.map((variable) => variable.name).join(', ')}\n`,
        )
      }
      let prepared: string | undefined
      await usePrompt(prompt, {
        valueFor: (variable) => {
          // A script's --var answers without a keyboard; anything else
          // still asks the terminal, and a script without the value stops
          // at the cancelled review below instead of hanging.
          const scriptedValue = scripted?.vars.get(variable.name)
          return scriptedValue === undefined
            ? question(`${UI_TEXT.promptVariables}: ${variable.name}`, signal)
            : Promise.resolve(scriptedValue)
        },
        review: async (text) => {
          signal.throwIfAborted()
          if (!isSilent) process.stdout.write(`${text}\n`)
          // The terminal prints the prepared text: nothing is inserted
          // into an editor, so the review says print, not insert. A
          // script confirms explicitly with --confirm after previewing
          // the same text in an earlier run without it.
          return (
            scripted?.confirmed === true ||
            isAffirmativeAnswer(await question(`${UI_TEXT.promptPrintConfirm} (y/N)`, signal))
          )
        },
        insert: (text) => {
          signal.throwIfAborted()
          prepared = text
          return Promise.resolve()
        },
      })
      return prepared
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
  log?: Logger,
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
      ui: terminalUi(
        command.command === 'prompts' && command.action === 'use'
          ? { vars: command.vars, confirmed: command.confirmed }
          : undefined,
        // JSON mode keeps stdout to the single result value; interactive
        // questions ask on stderr (Codex on PR #213).
        command.json,
      ),
      readBody: async () => {
        controller.signal.addEventListener('abort', cancelRead, { once: true })
        const deadline = setTimeout(stop, PROMPT_STDIN_TIMEOUT_MS)
        let text = ''
        const decoder = new TextDecoder('utf-8', { fatal: true })
        try {
          // NOLIMITS1FIX: the removed 128 KiB bound was invented — stdin
          // streams to its end at any size.
          for await (const chunk of process.stdin) {
            controller.signal.throwIfAborted()
            if (!(chunk instanceof Buffer)) throw new TypeError(UI_TEXT.promptFileInvalid)
            text += decoder.decode(chunk, { stream: true })
          }
          return text + decoder.decode()
        } catch (error: unknown) {
          if (
            error instanceof TypeError &&
            'code' in error &&
            error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
          )
            throw new Error(UI_TEXT.promptFileInvalid, { cause: error })
          throw error
        } finally {
          clearTimeout(deadline)
          controller.signal.removeEventListener('abort', cancelRead)
        }
      },
    })
    // Scripts opt into JSON; people still need the saved id, list, prepared
    // text and cancellation reason. A preview is not a command result.
    if (command.json) process.stdout.write(`${JSON.stringify(result)}\n`)
    else {
      const text = result.kind === 'prepared' ? result.text : sharingResultText(result)
      const output = result.kind === 'cancelled' ? process.stderr : process.stdout
      output.write(`${text}\n`)
    }
    return result.exitCode
  } catch (error: unknown) {
    if (isResourcePaused(error)) {
      process.stderr.write(`${error.message}\n`)
      return EXEC_EXIT.denied
    }
    // A defined refusal keeps its own sentence (an empty chat, a damaged
    // store, a prompt-file format error). Anything else is an unexpected
    // fault: the fixed could-not-complete reason on stderr, and the
    // underlying fault's name in the log the reason points at.
    let refusal = error instanceof Error ? sharingRefusal(error.message) : undefined
    if (error instanceof SharingArgumentError) refusal = error.message
    if (refusal === undefined) log?.warn(`sharing command failed: ${internalFaultForLog(error)}`)
    process.stderr.write(`${refusal ?? UI_TEXT.actionFailed}\n`)
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

export { runtimeSharingConfidential } from './confidential'
