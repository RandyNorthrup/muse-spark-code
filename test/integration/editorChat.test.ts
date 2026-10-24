// Editor chat (M95c part 2) inside the real Extension Development Host:
// the provider is the production createEditorChat; its models resolve
// through the real configured registry over a providers file plus an
// empty catalogue in a temp folder (resolve never leaves the machine,
// and the injected socket fails the suite if a request is ever sent);
// the opt-in selection is the real `editorChatModels` setting at Global
// (restored after each case); cancellation tokens, message roles and the
// progress report are the real editor API. Grants start empty, as on a
// fresh install; the consent dialog itself (a modal showWarningMessage)
// cannot be answered headlessly, so the grant click and the dispatched
// reply stay person-run steps — everything up to and around them is
// covered here, and nothing here sends a paid call.
import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  createEditorChatServices,
  writeEditorChatProvidersFile,
} from '../unit/helpers/editorChatRig'
import { createUsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { createLogger } from '../../src/host/logger'
import { createEditorChat } from '../../src/host/vscode/models/lmProvider'
import { readSettings } from '../../src/host/settings'
import { EDITOR_CHAT_VENDOR, SETTINGS_SECTION, UI_TEXT } from '../../src/shared/constants'

const LOCAL_REF = 'probe-custom/custom-model'
const UNPRICED_REF = 'probe-keyed/keyed-model'

async function seedSelected(refs: readonly string[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .update('editorChatModels', refs, vscode.ConfigurationTarget.Global)
}

function readSelected(): unknown {
  return vscode.workspace.getConfiguration(SETTINGS_SECTION).get('editorChatModels')
}

async function restoreSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration(SETTINGS_SECTION)
  await config.update('editorChatModels', undefined, vscode.ConfigurationTarget.Global)
  await config.update('confidentialWorkspace', undefined, vscode.ConfigurationTarget.Global)
}

function isFixedSentenceRefusal(error: unknown): boolean {
  assert.equal(error instanceof Error ? error.message : undefined, UI_TEXT.editorChatRefused)
  return true
}

interface EditorChatHarness {
  readonly service: EditorChatService
  readonly withdrawals: readonly string[]
}

/** The production provider over real stores, cleaned up afterwards. */
async function withEditorChat(work: (harness: EditorChatHarness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'editor-chat-test-'))
  const channel = vscode.window.createOutputChannel('editor chat test', { log: true })
  const log = createLogger(channel)
  const { configFile, catalogFile } = writeEditorChatProvidersFile(directory)
  const services = createEditorChatServices(configFile, catalogFile)
  const recording = createUsageRecording({
    client: 'editor-chat-test',
    isEnabled: () => true,
    now: () => Date.now(),
    newId: () => 'editor-chat-test-id',
    log,
    writer: (onWriteError) =>
      Promise.resolve(
        new UsageJournalStore(new NodeUsageFs(directory), {
          writerId: 'editor-chat-test-writer',
          isEnabled: () => true,
          now: () => Date.now(),
          sleep: () => Promise.resolve(),
          onWriteError: (_code, error) => {
            onWriteError(error)
          },
        }),
      ),
  })
  const confirmations: Record<string, string> = {}
  const withdrawals: string[] = []
  const config = () => vscode.workspace.getConfiguration(SETTINGS_SECTION)
  const service = createEditorChat({
    log,
    models: services.registry,
    recording,
    selected: () => config().get<unknown>('editorChatModels', []),
    allowed: () => !readSettings(config(), channel).confidentialWorkspace,
    now: Date.now,
    saveSelected: async (refs) => {
      await config().update('editorChatModels', refs, vscode.ConfigurationTarget.Global)
    },
    confirmations: () => confirmations,
    saveConfirmation: (ref, evidence) => {
      if (evidence === undefined) {
        Reflect.deleteProperty(confirmations, ref)
        withdrawals.push(ref)
      } else confirmations[ref] = evidence
      return Promise.resolve()
    },
  })
  try {
    await work({ service, withdrawals })
  } finally {
    await restoreSettings()
    channel.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}

type EditorChatService = ReturnType<typeof createEditorChat>

async function listOffered(service: EditorChatService) {
  const source = new vscode.CancellationTokenSource()
  try {
    return await service.provider.provideLanguageModelChatInformation({}, source.token)
  } finally {
    source.dispose()
  }
}

/** Token counting over a fixed probe word: the byte bound, offline. */
async function countProbeWord(service: EditorChatService, ref: string): Promise<number> {
  const source = new vscode.CancellationTokenSource()
  try {
    return await service.provider.provideTokenCount({ id: ref }, 'hello', source.token)
  } finally {
    source.dispose()
  }
}

suite('editor chat over the real editor API', () => {
  test('offers the opted-in model with its resolved limits and capabilities', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([LOCAL_REF])
      const rows = await listOffered(service)
      assert.equal(rows.length, 1)
      assert.deepEqual(rows[0], {
        id: LOCAL_REF,
        name: LOCAL_REF,
        family: EDITOR_CHAT_VENDOR,
        version: '1',
        maxInputTokens: 4096,
        maxOutputTokens: 512,
        capabilities: { toolCalling: true, imageInput: false },
      })
    })
  })

  test('offers nothing when no model is opted in', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([])
      assert.deepEqual(await listOffered(service), [])
    })
  })

  test('withdraws an unpriced model instead of offering it', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([UNPRICED_REF])
      assert.deepEqual(await listOffered(service), [])
    })
  })

  test('a confidential workspace offers nothing', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([LOCAL_REF])
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update('confidentialWorkspace', true, vscode.ConfigurationTarget.Global)
      assert.deepEqual(await listOffered(service), [])
    })
  })

  test('opting out clears the selection and withdraws the grant', async () => {
    await withEditorChat(async ({ service, withdrawals }) => {
      await seedSelected([LOCAL_REF])
      await service.toggle(LOCAL_REF)
      assert.deepEqual(readSelected(), [])
      assert.deepEqual(withdrawals, [LOCAL_REF])
    })
  })

  test('opting in to an unpriced model refuses with the fixed sentence', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([])
      await assert.rejects(service.toggle(UNPRICED_REF), isFixedSentenceRefusal)
      assert.deepEqual(readSelected(), [])
    })
  })

  test('a reply for a model that is not opted in refuses without dispatch', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([])
      const source = new vscode.CancellationTokenSource()
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'editor chat test' },
          async (progress) => {
            await assert.rejects(
              service.provider.provideLanguageModelChatResponse(
                { id: LOCAL_REF },
                [],
                {},
                progress,
                source.token,
              ),
              isFixedSentenceRefusal,
            )
          },
        )
      } finally {
        source.dispose()
      }
    })
  })

  test('token counting stays offline on the byte bound', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([LOCAL_REF])
      assert.equal(await countProbeWord(service, LOCAL_REF), 5)
    })
  })

  test('a cancelled count refuses without dispatch', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([LOCAL_REF])
      const source = new vscode.CancellationTokenSource()
      source.cancel()
      try {
        await assert.rejects(
          service.provider.provideTokenCount({ id: LOCAL_REF }, 'hello', source.token),
          isFixedSentenceRefusal,
        )
      } finally {
        source.dispose()
      }
    })
  })

  test('token counting refuses an unpriced model', async () => {
    await withEditorChat(async ({ service }) => {
      await seedSelected([UNPRICED_REF])
      await assert.rejects(countProbeWord(service, UNPRICED_REF), isFixedSentenceRefusal)
    })
  })
})
