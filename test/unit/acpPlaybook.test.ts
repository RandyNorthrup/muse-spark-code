import { describe, expect, it, vi } from 'vitest'
import { acpPlaybook } from '../../src/acp/playbook'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { parsePlaybookCommand, runPlaybookCommand } from '../../src/runtime/playbook/command'
import { surfacePort } from './playbookSurfaceFixtures'

// The journal bundle's slice, straight from its sources: parsing and
// rendering without the file-backed surface.
const bundle = { parsePlaybookCommand, runPlaybookCommand }
const loadBundle = () => bundle

describe('ACP /playbook local command', () => {
  it('renders status, record and settings through the same port as the CLI', async () => {
    for (const view of ['', 'status', 'record', 'settings']) {
      const result = await acpPlaybook(
        [{ type: 'text', text: `/playbook ${view}` }],
        () => surfacePort(),
        loadBundle,
      )
      expect(result?.ok).toBe(true)
      expect(result?.text).not.toBe('')
    }
  })
  it('records a reason and trusted actor/time, with no rule nine mutation', async () => {
    const port = surfacePort()
    const result = await acpPlaybook(
      [{ type: 'text', text: '/playbook settings offload off worker maintenance' }],
      () => port,
      loadBundle,
    )
    expect(result?.ok).toBe(true)
    expect(port.snapshot().settings.rules.offload).toMatchObject({
      enabled: false,
      reason: 'worker maintenance',
      actor: 'owner',
      at: 1_791_289_800_002,
    })
    const change = vi.spyOn(port, 'change')
    for (const text of [
      '/playbook settings neverAround off override',
      '/playbook settings offload off',
      '/playbook settings patchRoundsMax 3',
    ]) {
      expect(await acpPlaybook([{ type: 'text', text }], () => port, loadBundle)).toEqual({
        ok: false,
        text: UI_TEXT.playbookCommandUsage,
      })
    }
    expect(change).not.toHaveBeenCalled()
  })
  it('does not drop attachments, leak failures or touch the port for ordinary prompts', async () => {
    const factory = vi.fn(() => {
      throw new Error('private detail')
    })
    for (const text of ['hello', '/playbooks', 'please /playbook'])
      expect(await acpPlaybook([{ type: 'text', text }], factory, loadBundle)).toBeUndefined()
    expect(factory).not.toHaveBeenCalled()
    expect(
      await acpPlaybook(
        [
          { type: 'text', text: '/playbook' },
          { type: 'text', text: 'attached context' },
        ],
        factory,
        loadBundle,
      ),
    ).toEqual({ ok: false, text: UI_TEXT.playbookCommandUsage })
    expect(factory).not.toHaveBeenCalled()
    expect(await acpPlaybook([{ type: 'text', text: '/playbook' }], factory, loadBundle)).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
    expect(
      await acpPlaybook([{ type: 'text', text: '/playbook' }], () => undefined, loadBundle),
    ).toEqual({
      ok: false,
      text: UI_TEXT.playbookUnavailable,
    })
  })
  it('answers unavailable when the journal bundle cannot load', async () => {
    const port = surfacePort()
    expect(
      await acpPlaybook(
        [{ type: 'text', text: '/playbook status' }],
        () => port,
        () => {
          throw new Error(UI_TEXT.playbookUnavailable)
        },
      ),
    ).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
  })
})
