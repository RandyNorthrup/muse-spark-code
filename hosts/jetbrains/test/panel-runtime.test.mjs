import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'

test('the authored native runtime emits current initialization and complete panel payloads', async () => {
  const root = path.resolve(import.meta.dirname, '../../..')
  const { outputFiles } = await esbuild.build({
    stdin: {
      contents:
        "export { panelEnvelopeSchema, panelInitializeResultSchema } from './src/shared/hostApi/panel'; export { MHP_PANEL } from './src/shared/constants'",
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const { panelEnvelopeSchema, panelInitializeResultSchema, MHP_PANEL } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
  const inputs = [
    { jsonrpc: '2.0', id: 'init', method: 'initialize' },
    ...[
      { type: 'ready' },
      { type: 'sendMessage', localId: 'first', text: 'fixture first', attachmentIds: [] },
      { type: 'decideApproval', approvalId: 'approval-1', choiceId: 'fixture-once' },
      { type: 'sendMessage', localId: 'second', text: 'fixture second', attachmentIds: [] },
      { type: 'decideApproval', approvalId: 'approval-2', choiceId: 'fixture-deny' },
      { type: 'cancelTurn' },
    ].map((payload, index) => ({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panel',
      surface: 'fixture',
      direction: 'toHost',
      seq: index + 1,
      payload,
    })),
  ]
  const run = spawnSync('python3', [path.join(import.meta.dirname, 'fixtures/panel_ui.py')], {
    input: inputs.map((frame) => JSON.stringify(frame)).join('\n') + '\n',
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  })
  assert.equal(run.status, 0, run.stderr)
  const frames = run.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const initialized = panelInitializeResultSchema.safeParse(frames.shift())
  assert.equal(initialized.success, true, 'Invalid authored initialization result')
  let expectedSeq = 1
  for (const raw of frames) {
    const parsed = panelEnvelopeSchema.safeParse(raw)
    assert.equal(parsed.success, true, `Invalid authored panel payload: ${raw.payload.type}`)
    assert.equal(parsed.data.seq, expectedSeq++)
  }
  assert.equal(frames.length, 22)
})
