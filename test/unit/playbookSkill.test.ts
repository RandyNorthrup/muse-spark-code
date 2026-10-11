import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'
import { reviewerInstructionsFor } from '../../src/core/backends/modelapi/reviewer'
import { skillBodyForModel } from '../../src/core/context/skills'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import { reviewTurnText } from '../../src/core/review/reviewPrompt'
import { requireFile } from '../../src/host/lazyBundle'
import { bundledSkillsLoader } from '../../src/host/skills/bundledSkills'
import { PLAYBOOK_FINDING_CLASSES, UI_TEXT } from '../../src/shared/constants'
import { parseReviewBlock } from '../../src/shared/reviewFindings'
import { memoryContextIo } from './helpers/fakeContextIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FAKE_PLAYBOOK_MODULE } from './helpers/playbook/fakes'
import { buildHostBundles } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'
import {
  completeReview,
  design,
  latestRound,
  policyFixture,
  REVIEW_AGENTS,
  strike,
} from './playbookPolicyFixture'

const ID = 'orchestrator_playbook'
const ROOT = '/ws'
const FIRST_PARTY = '/ext/first-party-skills'
const skill = readFileSync(`first-party-skills/${ID}/SKILL.md`, 'utf8')
const built = { folder: '', file: '' }

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'm116k-charter-'))
  built.file = path.join(built.folder, 'bundledSkills.js')
  await buildHostBundles(built.folder, {
    bundledSkills: path.resolve('src/host/skills/bundledSkillsEntry.ts'),
  })
})
afterAll(() => removeFolder(built.folder))

function loadCharter(loadBundle: (file: string) => unknown = requireFile) {
  return bundledSkillsLoader({
    bundlePath: built.file,
    log: new FakeLogOutputChannel(),
    loadBundle,
  })
}

function context(files: Map<string, string>, isEnabled: () => boolean) {
  return new WorkspaceContext({
    io: memoryContextIo(files),
    workspaceRoot: ROOT,
    platform: 'linux',
    personalSkillsRoot: '/personal',
    personalAgentsRoot: undefined,
    hasAgents: false,
    isWorkspaceTrusted: () => true,
    loadMemory: undefined,
    warn: vi.fn(),
    bundledSkills: {
      firstPartyRoot: FIRST_PARTY,
      packageRoot: '/ext/vendor/high-quality-projects-skill',
      isEnabled,
    },
  })
}

/** Fixed inputs without a playbook catalogue: hashes pin pre-K request bytes. */
function ordinaryRequests(): string[] {
  const environment = { git: undefined }
  const requests = [
    instructionsFor({
      workspaceRoot: ROOT,
      platform: 'linux',
      shellToolName: 'shell',
      shellName: 'bash',
      hasShell: true,
      hasMemory: false,
      hasCodeIntel: false,
      today: '2026-10-06',
      environment,
      context: { rules: undefined, skills: [], agents: [], memory: [] },
    }),
    reviewerInstructionsFor({
      workspaceRoot: ROOT,
      platform: 'linux',
      toolNames: ['read_file', 'search'],
      today: '2026-10-06',
      environment,
      rules: undefined,
    }),
  ]
  for (const isRoleIncluded of [false, true])
    for (const focus of ['general', 'security'] as const)
      requests.push(
        reviewTurnText({
          request: { scope: 'custom', instructions: 'Review the cache.', focus },
          material: undefined,
          isRoleIncluded,
          newMarker: () => 'fixed-marker',
        }),
      )
  return requests
}

describe('M116 K skill and charter', () => {
  it('discovers the real skill through Model API context and loads its body only as a skill', async () => {
    const files = new Map([[`${FIRST_PARTY}/${ID}/SKILL.md`, skill]])
    let isEnabled = true
    const workspace = context(files, () => isEnabled)
    await workspace.load()
    const found = workspace.skill(ID)
    expect(found).toMatchObject({
      id: ID,
      name: 'orchestrator-playbook',
      source: 'bundled',
      packageRoot: FIRST_PARTY,
    })
    if (found === undefined) throw new Error('The shipped skill must be discoverable')
    expect(skillBodyForModel(found)).toContain('## Design decision at the third strike')
    isEnabled = false
    await workspace.refreshSkills()
    expect(workspace.skill(ID)).toBeUndefined()
  })

  it('keeps project and personal playbooks ahead of the bundled copy', async () => {
    for (const source of ['project', 'user']) {
      const folder = source === 'project' ? `${ROOT}/.agents/skills` : '/personal'
      const own = `---\nname: my-playbook\ndescription: My rules\n---\n\nMy body.`
      const workspace = context(
        new Map([
          [`${FIRST_PARTY}/${ID}/SKILL.md`, skill],
          [`${folder}/${ID}/SKILL.md`, own],
        ]),
        () => true,
      )
      await workspace.load()
      expect(workspace.skill(ID)).toMatchObject({ source, body: 'My body.' })
    }
  })

  it('loads the charter once on demand and leaves ordinary request bytes unchanged', () => {
    const original = ordinaryRequests()
    expect(createHash('sha256').update(JSON.stringify(original)).digest('hex')).toBe(
      '169525403d4e82ddd9f4c7695feef32b4fc248723f91254a7d4d3e61340478c9',
    )
    const load = vi.fn(requireFile)
    const bundle = loadCharter(load)
    expect(load).not.toHaveBeenCalled()
    expect(bundle().playbookReviewerCharter()).toContain('Playbook reviewer charter')
    bundle().playbookReviewerCharter()
    expect(load).toHaveBeenCalledOnce()
    expect(ordinaryRequests()).toEqual(original)
  })

  it('locks rule 9: an obvious bypass refusal binds, with no off switch and no reroute', () => {
    // Wrapping may move; the words may not. GROK-m116k P1 shipped
    // "refusals are advisory" green because nothing asserted this text.
    const words = skill.replaceAll(/\s+/gu, ' ')
    expect(words).toContain('An obvious bypass command is refused: do not run it')
    expect(words).toContain('The command-string guard is advisory only as a detector')
    expect(words).toContain('This rule has no off switch')
    expect(words).toContain('Never automatically retry or reroute a safety-classifier block')
    expect(words).not.toContain('refusals are advisory')
  })

  it('refuses a legacy bundle missing the charter instead of silently skipping the review contract', () => {
    const bundle = loadCharter(() => ({
      bundledSkillsStatus: () => undefined,
      installBundledSkills: () => undefined,
      removeBundledSkills: () => undefined,
    }))
    expect(() => bundle().playbookReviewerCharter()).toThrow(UI_TEXT.bundledSkillsUnavailable)
  })

  it('produces a schema-valid redesign example with complete coverage and exact prior-id resolution', () => {
    const charter = loadCharter()().playbookReviewerCharter()
    const json = /```muse-review\n([^]*?)\n```/.exec(charter)?.[1]
    if (json === undefined) throw new Error('The charter needs its review block example')
    const example = parseReviewBlock(json)
    expect(example?.coverage).toEqual([...PLAYBOOK_FINDING_CLASSES])
    expect(example?.resolution).toHaveLength(1)
    if (example === undefined) throw new Error('The charter example must parse')
    const { policy } = policyFixture()
    strike(policy)
    const priorId = latestRound(policy).findings[0]!.id
    expect(policy.recordDesignDecision(design()).kind).toBe('allow')
    // Rebind only the fixture id structurally, never by prompt substitution.
    const review = {
      ...example,
      resolution: example.resolution?.map((item) => ({ ...item, findingId: priorId })),
    }
    expect(completeReview(policy, FAKE_PLAYBOOK_MODULE, review, REVIEW_AGENTS).kind).toBe('allow')
    expect(policy.beforeFixRound(FAKE_PLAYBOOK_MODULE).kind).toBe('allow')
  })
})
