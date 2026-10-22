import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { applyTextEdits } from '../../core/codeIntel/codeText'
import type { VerifyHooks } from '../../core/backends/modelapi/verifyLoop'
import { isSamePath } from '../../core/paths'
import { isCodeLoading } from '../../core/verify/codeFiles'
import { fingerprint } from '../../core/verify/fingerprint'
import type { EditedFile, FileDiagnostics } from '../../core/verify/diagnosticsReport'
import { confineWorkspacePath } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import type { HostServices } from '../../shared/hostApi/methods'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import { diagnosticSchema, integerSchema, uriSchema } from '../../shared/hostApi/data'
import {
  EDITOR_DEFAULT_TAB_SIZE,
  DIAGNOSTICS_SETTLE_MAX_MS,
  FORMAT_TIMEOUT_MS,
  VERIFY_SHOWN_FILES_MAX,
} from '../../shared/constants'
import type { ExtensionSettings } from '../../host/settings'

/** Authored internal service result; the native owner attests the checked document version. */
const settledSchema = z.strictObject({
  uri: uriSchema,
  version: integerSchema,
  diagnostics: z.array(diagnosticSchema),
})

export interface RuntimeVerifyDeps {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly host: HostServices
  readonly realPath: (file: string) => Promise<string>
  readonly assertCurrent: () => void
  readonly settings: () => Pick<
    ExtensionSettings,
    'diagnosticsAfterEdits' | 'formatOnEdit' | 'checkCommands'
  >
  /** Null means analysis pending; undefined means no report or unsupported. */
  readonly settledDiagnostics: (
    uri: string,
    version: number,
    signal: AbortSignal,
  ) => Promise<unknown>
}

/** Verification consumes versioned editor data; formatting returns text for the tool's guarded writer. */
export function createRuntimeVerify(deps: RuntimeVerifyDeps) {
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted()
    ending.signal.throwIfAborted()
    deps.assertCurrent()
  }
  const sameUri = (left: string, right: string) => {
    const options = { windows: deps.platform === 'win32' }
    return isSamePath(fileURLToPath(left, options), fileURLToPath(right, options), deps.platform)
  }
  async function document(file: EditedFile, signal: AbortSignal) {
    check(signal)
    const paths = pathModule(deps.platform)
    const confined = await confineWorkspacePath(
      deps.workspaceRoot,
      paths.relative(deps.workspaceRoot, file.absolute),
      deps.platform,
      { realPath: deps.realPath },
    )
    check(signal)
    if (
      !confined.ok ||
      !isSamePath(confined.checkedAbsolute, file.absolute, deps.platform) ||
      isCodeLoading(confined.canonical)
    )
      throw new Error('MHP_VERIFY_PATH_REFUSED')
    const uri = pathToFileURL(file.absolute, { windows: deps.platform === 'win32' }).href
    const result = MHP_METHODS['documents/read'].result.parse(
      await deps.host.request('documents/read', { uri }, signal),
    )
    check(signal)
    if (!sameUri(result.document.uri, uri)) throw new Error('MHP_VERIFY_DOCUMENT_MISMATCH')
    return result
  }
  async function diagnostic(file: EditedFile, signal: AbortSignal): Promise<FileDiagnostics> {
    try {
      const before = await document(file, signal)
      if (before.document.dirty) return { file, entries: [], unchecked: 'unsaved' }
      if (file.fingerprint !== undefined && fingerprint(before.text) !== file.fingerprint)
        return { file, entries: [], unchecked: 'changed' }
      const deadline = Date.now() + DIAGNOSTICS_SETTLE_MAX_MS
      let report = await deps.settledDiagnostics(
        before.document.uri,
        before.document.version,
        signal,
      )
      while (report === null && Date.now() < deadline) {
        check(signal)
        await delay(Math.min(100, deadline - Date.now()), undefined, { signal })
        if (Date.now() >= deadline) break
        report = await deps.settledDiagnostics(before.document.uri, before.document.version, signal)
      }
      check(signal)
      if (report === undefined || report === null)
        return { file, entries: [], unchecked: 'noReport' }
      const settled = settledSchema.parse(report)
      if (!sameUri(settled.uri, before.document.uri) || settled.version !== before.document.version)
        return { file, entries: [], unchecked: 'changed' }
      const after = await document(file, signal)
      if (after.document.dirty) return { file, entries: [], unchecked: 'unsaved' }
      if (after.document.version !== before.document.version || after.text !== before.text)
        return { file, entries: [], unchecked: 'changed' }
      return {
        file,
        entries: settled.diagnostics
          .filter((entry) => sameUri(entry.uri, settled.uri))
          .map((entry) => ({
            path: file.relative.replaceAll('\\', '/'),
            severity: entry.severity,
            line: entry.range.start.line + 1,
            column: entry.range.start.character + 1,
            message: entry.message,
            source: entry.source,
          })),
      }
    } catch {
      return {
        file,
        entries: [],
        unchecked: signal.aborted || ending.signal.aborted ? 'stopped' : 'notShown',
      }
    }
  }
  async function track<T>(work: () => Promise<T>): Promise<T> {
    ending.signal.throwIfAborted()
    const running = work()
    pending.add(running)
    try {
      return await running
    } finally {
      pending.delete(running)
    }
  }
  const verify: VerifyHooks = {
    isDiagnosticsOn: () => deps.settings().diagnosticsAfterEdits,
    isFormatOnEdit: () => deps.settings().formatOnEdit,
    checkCommands: () => deps.settings().checkCommands,
    diagnosticsAfterEdit: (files, requestedSignal, canReadFile) =>
      track(async () => {
        const signal = AbortSignal.any([ending.signal, requestedSignal])
        const reports: FileDiagnostics[] = []
        const hasCodeLoadingFile = files.some((file) =>
          isCodeLoading(file.relative.replaceAll('\\', '/')),
        )
        for (const file of files) {
          if (signal.aborted) reports.push({ file, entries: [], unchecked: 'stopped' })
          else if (hasCodeLoadingFile || canReadFile?.(file) === false)
            reports.push({ file, entries: [], unchecked: 'codeLoading' })
          else if (reports.length >= VERIFY_SHOWN_FILES_MAX)
            reports.push({ file, entries: [], unchecked: 'tooMany' })
          else reports.push(await diagnostic(file, signal))
        }
        return reports
      }),
    formatAfterEdit: (absolute, text) =>
      track(async () => {
        const relative = pathModule(deps.platform)
          .relative(deps.workspaceRoot, absolute)
          .replaceAll('\\', '/')
        if (isCodeLoading(relative)) return
        const signal = AbortSignal.any([ending.signal, AbortSignal.timeout(FORMAT_TIMEOUT_MS)])
        const file = { absolute, relative }
        const before = await document(file, signal)
        if (before.document.dirty || before.text !== text) return
        const edits = MHP_METHODS['codeIntel/format'].result.parse(
          await deps.host.request(
            'codeIntel/format',
            {
              uri: before.document.uri,
              expectedVersion: before.document.version,
              tabSize: EDITOR_DEFAULT_TAB_SIZE,
              insertSpaces: true,
            },
            signal,
          ),
        )
        check(signal)
        const after = await document(file, signal)
        if (
          after.document.dirty ||
          after.document.version !== before.document.version ||
          after.text !== text
        )
          return
        const formatted = applyTextEdits(text, edits)
        return formatted === text ? undefined : formatted
      }),
    dispose: () => {
      ending.abort()
    },
  }
  return {
    verify,
    dispose: (): Promise<void> => {
      ending.abort()
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
