// M120 lane P: the preference editor's controller contract. Borrow timers,
// auto-order and secondary roles validate through the preference writers;
// template seeding, removal cleanup and dangling imports behave.
import { describe, expect, it } from 'vitest'
import {
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_BORROW_FINISH_GRACE_MS,
  TEAM_BORROW_LOOKAHEAD_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
  TEAM_EXPORT_FORMAT,
  TEAM_PANEL_EXPORT_VERSION,
  UI_TEXT,
} from '../../../src/shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../../src/shared/teamConversation'
import { fill } from '../../../src/shared/l10n/text'
import { teamEditorDocumentSchema } from '../../../src/shared/teamPanel'
import type { TeamEditorDocument } from '../../../src/shared/teamPanel'
import { panelRig } from '../helpers/teamPanelRig'

const TIMERS = {
  demandWaitMs: 90_000,
  lookaheadMs: TEAM_BORROW_LOOKAHEAD_MS,
  finishGraceMs: TEAM_BORROW_FINISH_GRACE_MS,
  recallWaitMs: TEAM_BORROW_RECALL_WAIT_MS,
  cooldownMs: TEAM_BORROW_COOLDOWN_MS,
}

async function seeded(template: 'pair' | 'full' = 'pair') {
  const rig = panelRig()
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template })
  return rig
}

function roleOf(document: TeamEditorDocument, role: string) {
  const found = document.roles.find((item) => item.role === role)
  if (found === undefined) throw new Error(`No ${role} role`)
  return found
}

async function firstEngineeringEntryId(rig: Awaited<ReturnType<typeof seeded>>) {
  const slice = await rig.read()
  const entryId = roleOf(slice.document, 'engineering').pool[0]?.id
  if (entryId === undefined) throw new Error('No entry')
  return entryId
}

describe('M120 lane P: the preference editor', () => {
  it('writes borrow timers and auto-order, and saves them with the team', async () => {
    const rig = await seeded()
    await rig.controller.handle({
      type: 'roles/updateRole',
      role: 'engineering',
      fields: { borrow: TIMERS, autoOrder: true },
    })
    const slice = await rig.read()
    expect(roleOf(slice.document, 'engineering').borrow).toEqual(TIMERS)
    expect(roleOf(slice.document, 'engineering').autoOrder).toBe(true)
    expect(slice.issues).toEqual([])
    await rig.controller.handle({ type: 'roles/save' })
    const stored = teamEditorDocumentSchema.parse(rig.store.get(TEAM_WORKSPACE_KEYS.team))
    expect(roleOf(stored, 'engineering').borrow).toEqual(TIMERS)
    expect(roleOf(stored, 'engineering').autoOrder).toBe(true)
  })

  it('refuses a below-floor demand wait with its sentence and keeps the old timers', async () => {
    const rig = await seeded()
    await expect(
      rig.controller.handle({
        type: 'roles/updateRole',
        role: 'engineering',
        fields: { borrow: { ...TIMERS, demandWaitMs: 59_000 } },
      }),
    ).rejects.toThrow(UI_TEXT.teamBorrowDemandWaitFloor)
    const slice = await rig.read()
    expect(roleOf(slice.document, 'engineering').borrow).toBeUndefined()
  })

  it('refuses other invalid timers as invalid', async () => {
    const rig = await seeded()
    await expect(
      rig.controller.handle({
        type: 'roles/updateRole',
        role: 'engineering',
        fields: { borrow: { ...TIMERS, lookaheadMs: -1 } },
      }),
    ).rejects.toThrow(UI_TEXT.teamEditor.invalid)
  })

  it('edits secondary roles in order and clears them', async () => {
    const rig = await seeded('full')
    const entryId = await firstEngineeringEntryId(rig)
    const assign = async (secondaryRoles: readonly string[]) => {
      await rig.controller.handle({
        type: 'roles/secondaryRoles',
        role: 'engineering',
        entryId,
        secondaryRoles: [...secondaryRoles],
      })
      const slice = await rig.read()
      return slice.document.assignments?.find((assignment) => assignment.candidateId === entryId)
        ?.secondaryRoles
    }
    expect(await assign(['code-review', 'qa'])).toEqual(['code-review', 'qa'])
    expect(await assign(['qa', 'code-review'])).toEqual(['qa', 'code-review'])
    expect(await assign([])).toEqual([])
  })

  it('says each secondary-roles refusal', async () => {
    const rig = await seeded()
    const entryId = await firstEngineeringEntryId(rig)
    const attempt = (secondaryRoles: readonly string[], id: string = entryId) =>
      rig.controller.handle({
        type: 'roles/secondaryRoles',
        role: 'engineering',
        entryId: id,
        secondaryRoles: [...secondaryRoles],
      })
    await expect(attempt(['ghost'])).rejects.toThrow(
      fill(UI_TEXT.teamRoleUnknown, { role: 'ghost' }),
    )
    await expect(attempt(['code-review', 'code-review'])).rejects.toThrow(
      UI_TEXT.teamSecondaryInvalid,
    )
    await expect(attempt(['engineering'])).rejects.toThrow(UI_TEXT.teamSecondaryInvalid)
    await expect(attempt(['code-review'], 'ghost-entry')).rejects.toThrow(UI_TEXT.teamEntryMissing)
    // Nothing was written: the entry keeps no row (pair seeds code-review
    // rows only, untouched by these attempts).
    const slice = await rig.read()
    const rows =
      slice.document.assignments?.filter((assignment) => assignment.candidateId === entryId) ?? []
    expect(rows).toEqual([])
  })

  it('drops assignments with their entry or role', async () => {
    const rig = await seeded('full')
    const entryId = await firstEngineeringEntryId(rig)
    await rig.controller.handle({
      type: 'roles/secondaryRoles',
      role: 'engineering',
      entryId,
      secondaryRoles: ['code-review', 'qa'],
    })
    await rig.controller.handle({ type: 'roles/removeRole', role: 'qa' })
    const stripped = await rig.read()
    const rows = stripped.document.assignments?.filter(
      (assignment) => assignment.candidateId === entryId,
    )
    expect(rows).toEqual([
      { candidateId: entryId, mainRole: 'engineering', secondaryRoles: ['code-review'] },
    ])
    await rig.controller.handle({ type: 'roles/removeEntry', role: 'engineering', entryId })
    const dropped = await rig.read()
    const kept =
      dropped.document.assignments?.filter((assignment) => assignment.candidateId === entryId) ?? []
    expect(kept).toEqual([])
    // A removed main role takes its entries' rows with it.
    const reviewEntryId = roleOf(dropped.document, 'code-review').pool[0]?.id
    if (reviewEntryId === undefined) throw new Error('No review entry')
    await rig.controller.handle({
      type: 'roles/secondaryRoles',
      role: 'code-review',
      entryId: reviewEntryId,
      secondaryRoles: ['engineering'],
    })
    await rig.controller.handle({ type: 'roles/removeRole', role: 'code-review' })
    const without = await rig.read()
    expect(
      without.document.assignments?.filter((assignment) => assignment.mainRole === 'code-review') ??
        [],
    ).toEqual([])
  })

  it('seeds template secondary roles and lets the editor clear them', async () => {
    const rig = await seeded('pair')
    const slice = await rig.read()
    const document = slice.document
    for (const role of document.roles) {
      for (const entry of role.pool) {
        const secondary = document.assignments?.find(
          (assignment) => assignment.candidateId === entry.id,
        )?.secondaryRoles
        expect(secondary).toEqual(role.role === 'code-review' ? ['engineering'] : undefined)
      }
    }
    // Demand wait floors and defaults still hold on a seeded team.
    expect(roleOf(document, 'engineering').borrow).toBeUndefined()
    const entryId = roleOf(document, 'code-review').pool[0]?.id
    if (entryId === undefined) throw new Error('No entry')
    await rig.controller.handle({
      type: 'roles/secondaryRoles',
      role: 'code-review',
      entryId,
      secondaryRoles: [],
    })
    const cleared = await rig.read()
    const kept = cleared.document.assignments?.find(
      (assignment) => assignment.candidateId === entryId,
    )?.secondaryRoles
    expect(kept).toEqual([])
  })

  it('blocks saving an import whose assignments dangle', async () => {
    const rig = await seeded()
    const before = await rig.read()
    const document = structuredClone(before.document)
    document.assignments = [
      { candidateId: 'ghost-entry', mainRole: 'engineering', secondaryRoles: ['ghost-role'] },
    ]
    const dangling = panelRig({
      readImport: () =>
        Promise.resolve(
          JSON.stringify({
            format: TEAM_EXPORT_FORMAT,
            version: TEAM_PANEL_EXPORT_VERSION,
            document,
          }),
        ),
    })
    await dangling.read()
    await dangling.controller.handle({ type: 'roles/import' })
    const imported = await dangling.read()
    expect(imported.issues).toContain(UI_TEXT.teamSecondaryDangling)
    await expect(dangling.controller.handle({ type: 'roles/save' })).rejects.toThrow(
      UI_TEXT.teamEditor.invalid,
    )
  })
})
