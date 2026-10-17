import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  installTeamProtocolSchemas,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
} from '../../src/shared/protocol'

describe('lazy team protocol validators', () => {
  it('keeps team.ts out of the ordinary protocol metafile', async () => {
    const bundled = await build({
      entryPoints: ['src/shared/protocol.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      minify: true,
      write: false,
      metafile: true,
    })
    expect(bundled.metafile.inputs).toHaveProperty('src/shared/protocol.ts')
    expect(bundled.metafile.inputs).not.toHaveProperty('src/shared/team.ts')
  })

  it('refuses team messages before activation while ordinary messages still parse', () => {
    expect(
      parseWebviewToHostMessage({ type: 'teamTreeAction', action: 'stop', taskId: 't' }).ok,
    ).toBe(false)
    expect(parseHostToWebviewMessage({ type: 'teamTree', tree: {} }).ok).toBe(false)
    expect(parseWebviewToHostMessage({ type: 'ready' }).ok).toBe(true)
    expect(parseHostToWebviewMessage({ type: 'focusInput' }).ok).toBe(true)
  })

  it('validates both team directions after the lazy factory installs their schemas', async () => {
    const schemas = await import('../../src/shared/team')
    installTeamProtocolSchemas({
      action: schemas.teamTreeActionSchema,
      update: schemas.teamTreeUpdateSchema,
    })
    const action = { type: 'teamTreeAction', action: 'stop', taskId: 'task-lazy' }
    expect(parseWebviewToHostMessage(action)).toEqual({ ok: true, message: action })
    expect(parseWebviewToHostMessage({ ...action, action: 'launch' }).ok).toBe(false)
    const emptyTree = {
      orchestrator: { model: 'second-model', backend: 'modelApi', slot: 'override' },
      roles: [],
    }
    const update = { type: 'teamTree', tree: emptyTree }
    expect(parseHostToWebviewMessage(update)).toEqual({ ok: true, message: update })
    expect(
      parseHostToWebviewMessage({ ...update, tree: { ...emptyTree, roles: 'invalid' } }).ok,
    ).toBe(false)
    expect(parseHostToWebviewMessage({ type: 'focusInput' }).ok).toBe(true)
  })
})
