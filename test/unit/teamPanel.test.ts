import { teamOffers } from './helpers/teamPanelOffers'
import * as autofill from '../../src/core/team/autofill'
import { Usd } from '../../src/shared/usd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { panelRig } from './helpers/teamPanelRig'
import { teamPanelExportSchema } from '../../src/shared/teamPanel'
import { parsePanelToHostMessage } from '../../src/shared/modelsPanel'
import { TEAM_WORKSPACE_KEYS, readTeamWorkspaceHint } from '../../src/shared/teamConversation'
import { TEAM_EXPORT_FORMAT, TEAM_PANEL_EXPORT_VERSION, UI_TEXT } from '../../src/shared/constants'
import { teamSnapshotSchema, type TeamCap } from '../../src/shared/teamConfig'
import { readOrchestratorOverride } from '../../src/core/team/orchestratorSlot'

async function pairSlice(rig: ReturnType<typeof panelRig>) {
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'pair' })
  return await rig.read()
}

describe('M96 U1 portable panel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the actual remaining budget and history for suggestions', async () => {
    const records: autofill.TeamRoleRecord[] = []
    const suggestions = vi.spyOn(autofill, 'buildTeamSuggestions')
    const rig = panelRig({
      remainingDailyBudgetUsd: () => Usd.from(0).toAmount(),
      records: () => records,
    })
    const slice = await pairSlice(rig)
    expect(slice.suggestions.some((item) => item.kind === 'roleBudget')).toBe(false)
    expect(suggestions.mock.calls.at(-1)?.[0].records).toBe(records)
  })
  it('awaits fresh durable budget and history getters on every refresh', async () => {
    let remaining = Usd.from('0.25').toAmount()
    let records: autofill.TeamRoleRecord[] = [
      { role: 'engineering', taskTokens: [100, 200, 300, 400, 500] },
    ]
    const suggestions = vi.spyOn(autofill, 'buildTeamSuggestions')
    const rig = panelRig({
      remainingDailyBudgetUsd: () => Promise.resolve(remaining),
      records: () => Promise.resolve(records),
    })
    const slice = await pairSlice(rig)
    expect(slice.suggestions.some((item) => item.kind === 'roleBudget')).toBe(true)
    expect(suggestions.mock.calls.at(-1)?.[0]).toMatchObject({
      remainingDailyBudgetUsd: remaining,
      records,
    })
    remaining = Usd.from(0).toAmount()
    records = [{ role: 'engineering', taskTokens: [1, 2] }]
    const refreshed = await rig.read()
    expect(refreshed.suggestions.some((item) => item.kind === 'roleBudget')).toBe(false)
    expect(suggestions.mock.calls.at(-1)?.[0].records).toBe(records)
  })

  it.each(['budget', 'history'] as const)(
    'refuses an unavailable %s source instead of fabricating a snapshot',
    async (source) => {
      const unavailable = () => Promise.reject(new Error(`Source unavailable: ${source}`))
      const rig = panelRig(
        source === 'budget' ? { remainingDailyBudgetUsd: unavailable } : { records: unavailable },
      )
      await expect(rig.read()).rejects.toThrow(UI_TEXT.teamBudgetUnavailable)
    },
  )

  it('refuses an invalid remaining budget before offering suggestions', async () => {
    const rig = panelRig({ remainingDailyBudgetUsd: () => Usd.from(-1).toAmount() })
    await expect(rig.controller.read()).rejects.toThrow(UI_TEXT.teamEditor.invalid)
  })
  it.each(['inputRate', 'outputRate', 'cachedRate', 'contextWindow'] as const)(
    'refuses invalid offer %s before showing an estimate',
    async (field) => {
      const offers = teamOffers()
      const first = offers[0]
      if (first === undefined) throw new Error('No offer')
      first[field] = -1
      const rig = panelRig({ offers: () => Promise.resolve(offers) })
      await expect(rig.controller.read()).rejects.toThrow()
    },
  )
  it('offers dollar budget suggestions only for priced key entries', async () => {
    for (const kind of ['local', 'unpriced']) {
      const offers = teamOffers()
      for (const offer of offers) {
        if (kind === 'local') offer.agent.pays = 'local'
        else offer.outputRate = undefined
      }
      const rig = panelRig({ offers: () => Promise.resolve(offers) })
      const slice = await pairSlice(rig)
      expect(slice.suggestions.some((item) => item.kind === 'roleBudget')).toBe(false)
    }
    const offers = teamOffers()
    const local = offers[1]
    if (local === undefined) throw new Error('No local offer')
    local.agent.pays = 'local'
    const rig = panelRig({ offers: () => Promise.resolve(offers) })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({
      type: 'roles/suggestion',
      role: 'code-review',
      kind: 'roleBudget',
      decision: 'accept',
    })
    const slice = await rig.read()
    const pool = slice.document.roles.find((role) => role.role === 'code-review')?.pool
    expect(slice.document.roles.find((role) => role.role === 'code-review')?.custom).toBe(true)
    expect(pool?.[0]?.caps.some((cap) => cap.measure === 'spendUsd')).toBe(false)
    expect(pool?.at(-1)?.caps.some((cap) => cap.measure === 'spendUsd')).toBe(true)
  })
  it('loads nothing and rejects edits with the team gate off', async () => {
    const offers = vi.fn(() => Promise.resolve(teamOffers()))
    const rig = panelRig({ isEnabled: () => false, offers })
    expect(await rig.controller.read()).toBeUndefined()
    await expect(
      rig.controller.handle({ type: 'roles/template', template: 'pair' }),
    ).rejects.toThrow()
    expect(offers).not.toHaveBeenCalled()
    expect(rig.update).not.toHaveBeenCalled()
  })
  it('prefills Pair, saves workspace state and reloads only after durable success', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const slice = await rig.read()
    expect(slice.issues).toEqual([])
    expect(slice.document.roles.map((role) => role.role)).toEqual(['engineering', 'code-review'])
    expect(slice.document.roles[0]?.pool.at(-1)?.agent).toBeUndefined()
    expect(slice.document.roles[1]?.pool[0]?.agent?.provider).toBe('reviewer')
    await rig.controller.handle({ type: 'roles/save' })
    expect(rig.store.get(TEAM_WORKSPACE_KEYS.team)).toMatchObject({ template: 'pair' })
    expect(rig.reload).toHaveBeenCalledOnce()
    const snapshot1 = await rig.read()
    expect(snapshot1.dirty).toBe(false)
  })
  it('persists Solo in the format the zero-traffic activation reader recognises', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'solo' })
    await rig.controller.handle({ type: 'roles/save' })
    expect(readTeamWorkspaceHint(rig.deps.state).soloTemplate).toBe(true)
    const snapshot2 = await rig.read()
    expect(snapshot2.document.roles).toEqual([])
  })
  it('keeps a failed save dirty and never reloads an unwritten team', async () => {
    const rig = panelRig({
      state: { get: () => undefined, update: () => Promise.reject(new Error('disk failure')) },
    })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await expect(rig.controller.handle({ type: 'roles/save' })).rejects.toThrow('disk failure')
    expect(rig.reload).not.toHaveBeenCalled()
    const snapshot3 = await rig.read()
    expect(snapshot3.dirty).toBe(true)
  })
  it('preserves custom caps through intensity changes and explicitly reapplies the level', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const snapshot4 = await rig.read()
    const first = snapshot4.document.roles[0]?.pool[0]
    if (first === undefined) throw new Error('No entry')
    await rig.controller.handle({
      type: 'roles/updateEntry',
      role: 'engineering',
      entryId: first.id,
      fields: { concurrent: 2 },
    })
    await rig.controller.handle({ type: 'roles/intensity', level: 'max' })
    const snapshot5 = await rig.read()
    expect(snapshot5.document.roles[0]?.pool[0]?.concurrent).toBe(2)
    await rig.controller.handle({ type: 'roles/reapply', role: 'engineering' })
    const snapshot6 = await rig.read()
    expect(snapshot6.document.roles[0]?.pool[0]?.concurrent).toBe(8)
  })
  it('reorders the exact pool the host will save and leaves Default last when adding', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({
      type: 'roles/addEntry',
      role: 'engineering',
      modelRef: 'reviewer/reviewer',
    })
    const snapshot7 = await rig.read()
    const pool = snapshot7.document.roles[0]?.pool
    const entry = pool?.[1]
    if (entry === undefined) throw new Error('No entry')
    expect(pool?.at(-1)?.agent).toBeUndefined()
    await rig.controller.handle({
      type: 'roles/moveEntry',
      role: 'engineering',
      entryId: entry.id,
      to: 0,
    })
    const snapshot8 = await rig.read()
    expect(snapshot8.document.roles[0]?.pool[0]?.id).toBe(entry.id)
    await expect(
      rig.controller.handle({
        type: 'roles/moveEntry',
        role: 'engineering',
        entryId: entry.id,
        to: 100,
      }),
    ).rejects.toThrow()
  })
  it('refuses incapable models, unsupported settings, ceilings and cap inversions at save', async () => {
    const offers = teamOffers()
    const firstOffer = offers[0]
    if (firstOffer === undefined) throw new Error('No offer')
    const rig = panelRig({ offers: () => Promise.resolve(offers) })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const snapshot9 = await rig.read()
    const entry = snapshot9.document.roles[0]?.pool[0]
    if (entry === undefined) throw new Error('No entry')
    await rig.controller.handle({
      type: 'roles/updateEntry',
      role: 'engineering',
      entryId: entry.id,
      fields: { settings: { verbosity: 'high' }, concurrent: 9 },
    })
    await rig.controller.handle({
      type: 'roles/cap',
      role: 'engineering',
      entryId: entry.id,
      index: 1,
      cap: { measure: 'tokens', window: 'day', amount: 2048 },
    })
    firstOffer.toolCalling = false
    const snapshot10 = await rig.read()
    expect(snapshot10.issues.length).toBeGreaterThan(2)
    await expect(rig.controller.handle({ type: 'roles/save' })).rejects.toThrow()
    expect(rig.update).not.toHaveBeenCalled()
  })
  it('checks Default against the unsaved orchestrator and confirms that choice on save', async () => {
    const confirmOrchestrator = vi.fn(() => Promise.resolve())
    const rig = panelRig({ confirmOrchestrator })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({
      type: 'roles/orchestrator',
      modelRef: 'reviewer/reviewer',
      settings: { effort: 'high' },
    })
    const snapshot11 = await rig.read()
    expect(snapshot11.defaultRef).toBe('reviewer/reviewer')
    await rig.controller.handle({ type: 'roles/save' })
    expect(confirmOrchestrator).toHaveBeenCalledWith('reviewer/reviewer')
  })
  it('asks before In Place, and closing while consent waits prevents an edit or save', async () => {
    const consent = Promise.withResolvers<boolean>()
    const rig = panelRig({
      confirmInPlace: () => consent.promise,
    })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const pending = rig.controller.handle({
      type: 'roles/updateRole',
      role: 'engineering',
      fields: { workspace: 'in-place' },
    })
    const snapshot12 = await rig.read()
    expect(snapshot12.document.roles[0]?.workspace).toBe('own-branch')
    rig.controller.dispose()
    consent.resolve(true)
    await expect(pending).rejects.toThrow()
    expect(rig.update).not.toHaveBeenCalled()
  })
  it('accepts the suggested preferred model first while preserving Default last', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'full' })
    const before = await rig.read()
    const suggestion = before.suggestions.find(
      (item) => item.modelRef !== undefined && item.kind !== 'poolFallback',
    )
    if (suggestion === undefined) throw new Error('No preferred model suggestion')
    await rig.controller.handle({
      type: 'roles/suggestion',
      role: suggestion.role,
      kind: suggestion.kind,
      decision: 'accept',
    })
    const accepted = await rig.read()
    const role = accepted.document.roles.find((item) => item.role === suggestion.role)
    expect(role?.pool[0]?.agent?.model).toBe(
      accepted.offers.find((item) => item.ref === suggestion.modelRef)?.agent.model,
    )
    expect(role?.pool.at(-1)?.agent).toBeUndefined()
  })
  it('persists suggestion dismissals and never starts a model during a preview', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'full' })
    const snapshot13 = await rig.read()
    const suggestion = snapshot13.suggestions[0]
    if (suggestion === undefined) throw new Error('No suggestion')

    await rig.controller.handle({
      type: 'roles/suggestion',
      role: suggestion.role,
      kind: suggestion.kind,
      decision: 'dismiss',
    })
    const snapshot14 = await rig.read()
    expect(
      snapshot14.suggestions.some(
        (item) => item.role === suggestion.role && item.kind === suggestion.kind,
      ),
    ).toBe(false)
    expect(rig.store.has('museSpark.team.suggestionDismissals')).toBe(true)
    await rig.controller.handle({ type: 'roles/preview', sample: 'review-branch' })
    const snapshot15 = await rig.read()
    expect(snapshot15.preview.steps).toHaveLength(1)
    expect(rig.reload).not.toHaveBeenCalled()
  })
  it('saves charters into the runtime schema and Reset to Default clears the canonical override', async () => {
    const rig = panelRig()
    await pairSlice(rig)
    const fields = { purpose: 'Build safely', done: 'Checks pass', guidance: 'Do not widen tools' }
    await rig.controller.handle({ type: 'roles/updateRole', role: 'engineering', fields })
    await rig.controller.handle({ type: 'roles/orchestrator', modelRef: 'reviewer/reviewer' })
    await rig.controller.handle({ type: 'roles/save' })
    expect(
      teamSnapshotSchema.parse(rig.store.get(TEAM_WORKSPACE_KEYS.team)).roles[0],
    ).toMatchObject(fields)
    const state = { get: (key: string) => rig.store.get(key) }
    expect(readOrchestratorOverride(state)?.modelId).toBe('reviewer')
    await rig.controller.handle({ type: 'roles/orchestrator' })
    await rig.controller.handle({ type: 'roles/save' })
    expect(readOrchestratorOverride(state)).toBeUndefined()
  })
  it('refused orchestrator confirmation leaves the saved workspace unchanged', async () => {
    const rig = panelRig({ confirmOrchestrator: () => Promise.reject(new Error('refused')) })
    await pairSlice(rig)
    await rig.controller.handle({ type: 'roles/orchestrator', modelRef: 'reviewer/reviewer' })
    await expect(rig.controller.handle({ type: 'roles/save' })).rejects.toThrow('refused')
    expect(rig.update).not.toHaveBeenCalled()
    expect(rig.reload).not.toHaveBeenCalled()
  })
  it('round trips charter text, settings and intensity while import remains an unsaved draft', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({
      type: 'roles/updateRole',
      role: 'engineering',
      fields: { purpose: 'Build it', done: 'Checks pass', guidance: 'Use small changes' },
    })
    await rig.controller.handle({ type: 'roles/export' })
    const text = rig.writeExport.mock.calls[0]?.[0]
    if (text === undefined) throw new Error('No export')
    const raw: unknown = JSON.parse(text)
    expect(teamPanelExportSchema.safeParse(raw).success).toBe(true)
    expect(text).not.toMatch(/endpoint|api_key|commandLine|credential/)
    const imported = panelRig({ readImport: () => Promise.resolve(text) })
    await imported.read()
    await imported.controller.handle({ type: 'roles/import' })
    const snapshot16 = await rig.read()
    const snapshot17 = await imported.read()
    expect(snapshot17.document).toEqual(snapshot16.document)
    expect(imported.update).not.toHaveBeenCalled()
    expect(imported.reload).not.toHaveBeenCalled()
  })
  it('clears the import notice when the draft is reset', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({ type: 'roles/export' })
    const text = rig.writeExport.mock.calls[0]?.[0]
    if (text === undefined) throw new Error('No export')
    const imported = panelRig({ readImport: () => Promise.resolve(text) })
    await imported.read()
    await imported.controller.handle({ type: 'roles/import' })
    const noticed = await imported.read()
    expect(noticed.notice).toBe(UI_TEXT.teamImportDraft)
    await imported.controller.handle({ type: 'roles/reset' })
    const cleared = await imported.read()
    expect(cleared.notice).toBeUndefined()
  })
  it('rejects unknown import keys and marks unavailable references without substituting an agent', async () => {
    const source = panelRig()
    await source.read()
    await source.controller.handle({ type: 'roles/template', template: 'pair' })
    const { document } = await source.read()
    const invalid = JSON.stringify({
      format: TEAM_EXPORT_FORMAT,
      version: TEAM_PANEL_EXPORT_VERSION,
      document,
      endpoint: 'https://example.invalid',
    })
    const bad = panelRig({ readImport: () => Promise.resolve(invalid) })
    await bad.read()
    await expect(bad.controller.handle({ type: 'roles/import' })).rejects.toThrow()
    expect(bad.update).not.toHaveBeenCalled()
    const missing = panelRig({
      offers: () => Promise.resolve(teamOffers().slice(0, 1)),
      readImport: () =>
        Promise.resolve(
          JSON.stringify({
            format: TEAM_EXPORT_FORMAT,
            version: TEAM_PANEL_EXPORT_VERSION,
            document,
          }),
        ),
    })
    await missing.read()
    await missing.controller.handle({ type: 'roles/import' })
    const snapshot18 = await missing.read()
    expect(snapshot18.issues).toContain(UI_TEXT.teamEntryMissing)
    await expect(missing.controller.handle({ type: 'roles/save' })).rejects.toThrow()
  })
  it('preserves manual Default concurrency through orchestrator settings and model changes', async () => {
    const offers = teamOffers()
    const reviewer = offers[1]
    if (reviewer === undefined) throw new Error('No reviewer')
    reviewer.ceiling = 2
    const rig = panelRig({ offers: () => Promise.resolve(offers) })
    const slice = await pairSlice(rig)
    const fallback = slice.document.roles[0]?.pool.at(-1)
    if (fallback === undefined) throw new Error('No Default')
    await rig.controller.handle({
      type: 'roles/updateEntry',
      role: 'engineering',
      entryId: fallback.id,
      fields: { concurrent: 1 },
    })
    for (const modelRef of ['main/main', reviewer.ref, undefined]) {
      await rig.controller.handle({
        type: 'roles/orchestrator',
        modelRef,
        settings: { effort: 'high' },
      })
      const edited = await rig.read()
      expect(edited.document.roles[0]?.pool.at(-1)?.concurrent).toBe(1)
      expect(edited.document.roles[0]?.custom).toBe(true)
      expect(edited.issues).toEqual([])
    }
    await rig.controller.handle({
      type: 'roles/updateEntry',
      role: 'engineering',
      entryId: fallback.id,
      fields: { concurrent: 8 },
    })
    await rig.controller.handle({ type: 'roles/orchestrator', modelRef: reviewer.ref })
    const clamped = await rig.read()
    expect(clamped.document.roles[0]?.pool.at(-1)?.concurrent).toBe(2)
    await rig.controller.handle({ type: 'roles/orchestrator', modelRef: 'main/main' })
    const preserved = await rig.read()
    expect(preserved.document.roles[0]?.pool.at(-1)?.concurrent).toBe(2)
    await rig.controller.handle({ type: 'roles/reapply', role: 'engineering' })
    const reapplied = await rig.read()
    expect(reapplied.document.roles[0]?.pool.at(-1)?.concurrent).toBe(4)
  })
  it('caps generated Default entries at the resolved model ceiling', async () => {
    const offers = teamOffers()
    for (const offer of offers) offer.ceiling = 1
    const rig = panelRig({ offers: () => Promise.resolve(offers) })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const slice = await rig.read()
    expect(slice.issues).toEqual([])
    for (const role of slice.document.roles) {
      expect(role.pool.at(-1)?.agent).toBeUndefined()
      for (const entry of role.pool) expect(entry.concurrent).toBeLessThanOrEqual(1)
    }
  })
  it('caps regenerated Default entries at an unsaved orchestrator override', async () => {
    const offers = teamOffers()
    const reviewer = offers[1]
    if (reviewer === undefined) throw new Error('No reviewer offer')
    reviewer.ceiling = 1
    const rig = panelRig({ offers: () => Promise.resolve(offers) })
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    await rig.controller.handle({ type: 'roles/orchestrator', modelRef: reviewer.ref })
    await rig.controller.handle({ type: 'roles/reapply', role: 'engineering' })
    const slice = await rig.read()
    expect(slice.issues).toEqual([])
    const pool = slice.document.roles.find((role) => role.role === 'engineering')?.pool ?? []
    expect(pool.at(-1)?.agent).toBeUndefined()
    for (const entry of pool)
      if (entry.agent === undefined) expect(entry.concurrent).toBeLessThanOrEqual(1)
  })
  it.each([
    { measure: 'spendUsd', window: 'day', amount: 0.000001 },
    { measure: 'outputTokens', window: 'task', amount: 1 },
  ] satisfies TeamCap[])(
    'switches the preview off an entry a non-token cap prices out (%j)',
    async (cap) => {
      const rig = panelRig()
      await rig.read()
      await rig.controller.handle({ type: 'roles/template', template: 'pair' })
      const before = await rig.read()
      const primary = before.document.roles.find((role) => role.role === 'engineering')?.pool[0]
      if (primary === undefined) throw new Error('No primary entry')
      await rig.controller.handle({
        type: 'roles/cap',
        role: 'engineering',
        entryId: primary.id,
        index: primary.caps.length,
        cap,
      })
      const slice = await rig.read()
      const step = slice.preview.steps.find((item) => item.role === 'engineering')
      expect(step?.switched).toBe(true)
      expect(step?.model).toBe(slice.defaultRef)
      expect(slice.preview.unstaffed).not.toContain('engineering')
    },
  )
  it('splits an accepted role budget across the priced entries', async () => {
    const rig = panelRig()
    const slice = await pairSlice(rig)
    const suggestion = slice.suggestions.find(
      (item) => item.role === 'engineering' && item.kind === 'roleBudget',
    )
    if (suggestion?.amount === undefined) throw new Error('No engineering budget suggestion')
    await rig.controller.handle({
      type: 'roles/suggestion',
      role: 'engineering',
      kind: 'roleBudget',
      decision: 'accept',
    })
    const after = await rig.read()
    const pool = after.document.roles.find((role) => role.role === 'engineering')?.pool ?? []
    const dayCaps = pool.flatMap((entry) =>
      entry.caps.filter((cap) => cap.measure === 'spendUsd' && cap.window === 'day'),
    )
    expect(dayCaps.length).toBe(2)
    for (const cap of dayCaps) expect(cap.amount).toBe(suggestion.amount / 2)
    expect(dayCaps.reduce((sum, cap) => sum + cap.amount, 0)).toBeCloseTo(suggestion.amount, 10)
  })
  it('rejects nested secret and command fields at the panel boundary', () => {
    expect(
      parsePanelToHostMessage({
        type: 'roles/updateRole',
        role: 'engineering',
        fields: { purpose: 'test', commandLine: 'bad' },
      }).ok,
    ).toBe(false)
    expect(
      parsePanelToHostMessage({
        type: 'roles/updateEntry',
        role: 'engineering',
        entryId: 'entry',
        fields: { settings: { effort: 'high', api_key: 'synthetic' } },
      }).ok,
    ).toBe(false)
  })
})
