// M95b acceptance 10, end to end: a hook event fired by a session on a
// plan model carries the plan provider id and the qualified model. The
// real host starts a real session, the real parser reads a
// person-authored spark-hooks.json, the real dispatcher spawns the real
// hook command, and the command records the stdin bytes it was given.
// No turn runs, so the keyless rig would fail any network use loudly.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseSparkHooksConfig } from '../../src/core/backends/modelapi/extensionHooks'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { modelApiRig } from './helpers/conversationPanel'
import { usingTempDir } from './helpers/temporaryFolders'

const CHATGPT_MODEL = 'chatgpt/gpt-6.1-sol'
const COPILOT_MODEL = 'copilot/gpt-4o'

const recorder = (): string =>
  fileURLToPath(new URL('helpers/hookStdinRecorder.mjs', import.meta.url))

const quoted = (value: string): string => `"${value}"`

describe('plan-turn hook envelope', () => {
  it('fires each model switch with its own provider and qualified model', async () => {
    await usingTempDir('hook-plan-provider-', async (root) => {
      const capture = path.join(root, 'payloads.jsonl')
      const command = `${quoted(process.execPath)} ${quoted(recorder())} ${quoted(capture)}`
      const parsed = parseSparkHooksConfig(
        JSON.stringify({ hooks: { PreModelSwitch: [{ hooks: [{ type: 'command', command }] }] } }),
        'project',
        process.platform,
      )
      expect(parsed.warnings).toEqual([])
      expect(parsed.hooks).toHaveLength(1)

      const rig = modelApiRig(root, () => Promise.resolve(parsed.hooks), true)
      // Each switch fires before resolving, carrying the model the
      // session is leaving; the bare target resolves nothing, so no
      // key or catalogue is needed to observe the envelope.
      const chatgpt = await rig.host.startSession({
        workspaceRoot: root,
        modelId: CHATGPT_MODEL,
        approvalMode: 'promptUnmatched',
      })
      try {
        await chatgpt.setModel(DEFAULT_MODEL_ID)
        await chatgpt.setModel(DEFAULT_MODEL_ID)
      } finally {
        chatgpt.dispose()
      }
      const copilot = await rig.host.startSession({
        workspaceRoot: root,
        modelId: COPILOT_MODEL,
        approvalMode: 'promptUnmatched',
      })
      try {
        await copilot.setModel(DEFAULT_MODEL_ID)
      } finally {
        copilot.dispose()
      }

      const captured = await readFile(capture, 'utf8')
      const lines = captured.split('\n').filter((line) => line.trim() !== '')
      expect(lines).toHaveLength(3)
      const payloads = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(payloads.map((payload) => payload['hook_event_name'])).toEqual([
        'PreModelSwitch',
        'PreModelSwitch',
        'PreModelSwitch',
      ])
      expect(payloads.map((payload) => [payload['model'], payload['model_provider']])).toEqual([
        [CHATGPT_MODEL, 'chatgpt'],
        [DEFAULT_MODEL_ID, 'meta'],
        [COPILOT_MODEL, 'copilot'],
      ])
    })
  })
})
