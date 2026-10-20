// Help's feature entries combine the feature's own details with the reference
// generator's REFERENCE_DETAILS. Lane MONEY017E found the merge overwrote the
// feature-level list, which erased the schedules media limitation (and the
// accounts developer detail) from Help before accounts publication was removed.

import { describe, expect, it } from 'vitest'
import { featureCatalog, referenceDescription } from '../../src/shared/featureCatalog'
import { readFileSync } from 'node:fs'
import { EN } from '../../src/shared/l10n/en'
import { referenceModel } from '../../src/shared/reference/reference.generated'

/** The `ui` keys of one catalogue entry's details. */
function detailKeys(id: string): string[] {
  const feature = featureCatalog().find((entry) => entry.id === id)
  if (feature === undefined) throw new Error(`missing feature: ${id}`)
  return feature.details.flatMap((detail) => ('ui' in detail ? detail.ui : []))
}

describe('feature catalogue details merge', () => {
  it('names runtime schedules separately from Model API loop and scopes disabled delivery to VS Code', () => {
    const runtime = featureCatalog().find((entry) => entry.id === 'runtime-schedules')
    expect(runtime).toMatchObject({
      name: { ui: 'runtimeSchedulesItem' },
      description: { ui: 'runtimeSchedulesItemDetail' },
    })
    expect(EN.runtimeSchedulesItem).toBe('Runtime schedules')
    expect(EN.runtimeSchedulesItemDetail).toContain('ACP or the terminal')
    expect(EN.referenceSchedules).toContain('Automatic VS Code v2 prompt delivery is disabled.')
    expect(EN.referenceRuntimeSchedules).toContain('unattended Muse Code prompts')
    expect(detailKeys('runtime-schedules')).toContain('referenceRuntimeSchedules')
  })
  it('keeps the schedules feature-level details beside reference details', () => {
    expect(detailKeys('schedules')).toContain('referenceSchedules')
    expect(detailKeys('schedules')).toContain('referenceSchedulePaidConsent')
    expect(detailKeys('schedules')).toContain('scheduledMediaSupport')
  })

  it('publishes accounts with the developer detail beside the developer CLI route', () => {
    expect(detailKeys('accounts')).toEqual(['referenceDeveloper'])
    const published = referenceModel()
    expect(published.features.find((feature) => feature.id === 'accounts')?.details).toEqual([
      { ui: 'referenceDeveloper' },
    ])
    expect(published.cli.some((command) => command.route === 'developer')).toBe(true)
  })

  it('still merges the reference details in', () => {
    expect(detailKeys('chat')).toContain('referenceThinking')
    expect(detailKeys('permissions')).toContain('referencePermissionLimits')
    // The train keeps the vault dormant (REFERENCE_IN_PROGRESS_FEATURES), so
    // Help shows the in-progress summary with no feature details. The
    // summary pins the dormant state: an active vault would show its own
    // panel summary here instead.
    expect(detailKeys('vault')).toEqual([])
    const vault = featureCatalog().find((entry) => entry.id === 'vault')
    expect(vault?.summary).toEqual({ ui: 'referenceInProgress' })
  })

  it('certifies argument previews on both the panel and ACP surfaces', () => {
    // RVCM1062B P3: previews are certified in VS Code and ACP, so the
    // catalogue and its generated reference must name both surfaces.
    const preview = featureCatalog().find((entry) => entry.id === 'argument-preview')
    if (preview === undefined) throw new Error('missing feature: argument-preview')
    expect(preview.summary).toEqual({ ui: 'toolArgumentPreviewDescription' })
    expect(EN.toolArgumentPreviewDescription).toContain('before the tool runs')
    expect(preview.editors).toEqual(['vscode', 'acp'])
    expect(preview.surfaces).toEqual(['vscode:modelApi', 'acp:modelApi'])
  })

  it('ships the schedules limitation in the generated reference model', () => {
    const schedules = referenceModel().features.find((feature) => feature.id === 'schedules')
    if (schedules === undefined) throw new Error('missing generated schedules feature')
    const keys = schedules.details.flatMap((detail) => ('ui' in detail ? detail.ui : []))
    const consent = schedules.details.find(
      (detail) =>
        'conditions' in detail &&
        detail.conditions.some(
          ({ text }) => 'ui' in text && text.ui === 'referenceSchedulePaidConsent',
        ),
    )
    expect(consent).toEqual(referenceDescription({ ui: 'referenceSchedulePaidConsent' }))
    expect(consent).toMatchObject({ conditions: [{ when: 'scheduleDeliveryCertified=false' }] })
    expect(EN.referenceSchedulePaidConsent).toContain('neither asks')
    expect(EN.referenceSchedulePaidConsent).toContain('shared daily budget')
    const roadmap = readFileSync(new URL('../../ROADMAP.md', import.meta.url), 'utf8')
    expect(roadmap).toContain('neither asks for v2 consent nor reserves paid caps')
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    expect(readme).not.toContain('unattended runs are opt-in')
    expect(readme).toContain('does not request v2 consent or reserve its paid caps')
    expect(keys).toContain('scheduledMediaSupport')
    expect(EN.scheduledMediaSupport).toContain('unsupported in this version')
  })
  it.each(['schedules', 'scheduleDefaultDelivery'])(
    'conditions %s unattended/default/grant claims on certified delivery',
    (setting) => {
      const entry = referenceModel().settings.find((row) => row.id === `museSpark.${setting}`)
      expect(entry?.text).toEqual(referenceDescription({ setting }))
      expect(entry?.text).toMatchObject({
        conditions: [{ when: 'scheduleDeliveryCertified=true' }],
      })
    },
  )
  it('keeps scheduleAgentCreation out of the published reference while it is held', () => {
    // The release line publishes dormant-feature settings nowhere until their
    // owner binds them (WB-013: agent creation has no installed setting
    // reader). The switch restores delivery routes, not held settings.
    const entry = referenceModel().settings.find(
      (row) => row.id === 'museSpark.scheduleAgentCreation',
    )
    expect(entry).toBeUndefined()
  })
})
