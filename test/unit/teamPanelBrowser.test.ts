import { beforeEach, describe, expect, it, vi } from 'vitest'
import { panelRig } from './helpers/teamPanelRig'

beforeEach(() => {
  vi.resetModules()
})

describe('M96 optional browser validators', () => {
  it('does not admit a team contract before loading or for an ordinary provider state', async () => {
    const browser = await import('../../src/webview/models/teamPanelBrowser')
    const message = { type: 'roles/save' }
    expect(browser.teamTemplateSchema.safeParse('pair').success).toBe(true)
    expect(browser.teamTemplateSchema.safeParse('unknown').success).toBe(false)
    expect(browser.teamPreviewSampleSchema.safeParse('review-branch').success).toBe(true)
    expect(browser.teamPreviewSampleSchema.safeParse('unknown').success).toBe(false)
    expect(browser.teamAgentsSliceSchema.safeParse({}).success).toBe(false)
    expect(browser.teamPanelMessageSchema.safeParse(message).success).toBe(false)
    await browser.loadTeamPanelSchemas({ type: 'modelsPanel/state', state: { providers: [] } })
    expect(browser.teamPanelMessageSchema.safeParse(message).success).toBe(false)
  })
  it('loads the strict canonical validators once a team payload arrives and refuses unknown keys', async () => {
    const browser = await import('../../src/webview/models/teamPanelBrowser')
    const slice = await panelRig().read()
    await Promise.all([
      browser.loadTeamPanelSchemas({ state: { roles: slice } }),
      browser.loadTeamPanelSchemas({ state: { agents: {} } }),
    ])
    expect(browser.teamPanelSliceSchema.safeParse(slice).success).toBe(true)
    expect(browser.teamAgentsSliceSchema.safeParse({}).success).toBe(true)
    expect(browser.teamAgentsSliceSchema.safeParse({ command: 'fixture' }).success).toBe(false)
    expect(
      browser.teamPanelSliceSchema.safeParse({ ...slice, credential: 'fixture' }).success,
    ).toBe(false)
    expect(browser.teamPanelMessageSchema.safeParse({ type: 'roles/save' }).success).toBe(true)
    expect(
      browser.teamPanelMessageSchema.safeParse({ type: 'roles/save', command: 'fixture' }).success,
    ).toBe(false)
  })
})
