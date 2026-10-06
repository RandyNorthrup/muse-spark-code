import type { GitFacts, PlanLane } from '../sources/types'
import { tableCells, planTables, comparePlanText, type PlanLine } from './grammar'

/** Evidence is already captured/validated by S/N; the reader performs no IO. */
export interface PlanEvidence {
  readonly branches?: GitFacts['branches']
  readonly pullRequests?: readonly {
    readonly branch: string
    readonly number: number
    readonly state: string
  }[]
  readonly certificationPaths?: readonly string[]
}

const LANE_COLUMNS = new Set([
  'Lane',
  'Lane / receipt',
  'Scope',
  'Items',
  'Owns',
  'Own files',
  'Shared files (region)',
  'Files it owns',
  'Its regions in shared files',
  'Starts',
  'Rig',
  'Hours',
  'Current state',
  'Muse implementation ownership',
  'Codex review / acceptance focus',
  'Review focus',
  'Muse owns',
  'Codex review focus',
  'Adds',
])

function shortRef(name: string): string {
  return name
    .replace(/^refs\/(?:heads|remotes)\//, '')
    .replace(/^remotes\//, '')
    .replace(/^[^/]+\/(?=(?:feature\/|m\d+\/))/, '')
}

export function readLanes(
  body: readonly PlanLine[],
  milestoneId: string,
  evidence: PlanEvidence,
  drift: { code: string; line: number; detail: string }[],
): PlanLane[] {
  const lanes: PlanLane[] = []
  for (const { columns, line, rows } of planTables(body, drift)) {
    if (columns[0] !== 'Lane' && columns[0] !== 'Lane / receipt') continue
    if (
      columns.some((column) => !LANE_COLUMNS.has(column)) ||
      new Set(columns).size !== columns.length
    ) {
      drift.push({ code: 'lanes-columns', line, detail: columns.join(' | ') })
      continue
    }
    for (const row of rows) {
      const cells = tableCells(row.text)
      if (cells.length === columns.length) {
        const cell = (name: string) => cells[columns.indexOf(name)] ?? ''
        const id = (cells[0] ?? '').replaceAll(/[*`]/g, '').split(/\s+/, 1)[0] ?? ''
        const prefix = milestoneId.toLowerCase()
        const laneIds = id === '0' ? ['0', 'l0'] : [id.toLowerCase()]
        const isLaneBranch = (name: string) => {
          const ref = shortRef(name).toLowerCase()
          return laneIds.some(
            (lane) =>
              ref === `${prefix}/${lane}` ||
              ref.startsWith(`${prefix}/${lane}-`) ||
              ref.startsWith(`feature/${prefix}-${lane}-`) ||
              ref === `feature/${prefix}-${lane}`,
          )
        }
        const branches = (evidence.branches ?? [])
          .filter(({ name }) => isLaneBranch(name))
          .toSorted(
            (a, b) => Number(b.merged) - Number(a.merged) || comparePlanText(a.name, b.name),
          )
        const pulls = (evidence.pullRequests ?? [])
          .filter((pull) => isLaneBranch(pull.branch) && pull.state === 'open')
          .toSorted((a, b) => a.number - b.number)
        const branchNames = branches.map(({ name }) => shortRef(name))
        const pullNames = pulls.map(({ branch }) => shortRef(branch))
        const pullRefs = new Set(pullNames)
        const exactRefs = [...new Set(branchNames.filter((ref) => pullRefs.has(ref)))]
        const candidates = new Set([...branchNames, ...pullNames])
        let selectedRef: string | undefined
        if (exactRefs.length === 1) selectedRef = exactRefs[0]
        else if (exactRefs.length === 0 && candidates.size === 1) selectedRef = [...candidates][0]
        const matchingBranches = branches.filter(({ name }) => shortRef(name) === selectedRef)
        const matchingPulls = pulls.filter(({ branch }) => shortRef(branch) === selectedRef)
        const isAmbiguous =
          candidates.size > 0 &&
          (selectedRef === undefined ||
            matchingPulls.length > 1 ||
            new Set(matchingBranches.map(({ merged }) => merged)).size > 1)
        if (isAmbiguous)
          drift.push({ code: 'lanes-ambiguous', line: row.line, detail: `${milestoneId}:${id}` })
        const branch = isAmbiguous ? undefined : matchingBranches[0]
        const pull = isAmbiguous ? undefined : matchingPulls[0]
        const certification =
          (evidence.certificationPaths ?? [])
            .map((path) => path.replaceAll('\\', '/'))
            .filter(
              (path) =>
                path.toLowerCase() === `docs/certification/${prefix}-${id.toLowerCase()}.md` ||
                path.toLowerCase() === `docs/certification/${prefix}.md`,
            )
            .toSorted(comparePlanText)[0] ?? null
        const hours = cell('Hours')
        let state: PlanLane['state'] = branch ? 'inProgress' : 'planned'
        if (pull) state = 'inReview'
        if (branch?.merged) state = 'merged'
        lanes.push({
          id,
          scope:
            cell('Items') ||
            cell('Scope') ||
            cell('Owns') ||
            cell('Muse implementation ownership') ||
            cell('Muse owns') ||
            cell('Adds'),
          branch: branch?.name ?? pull?.branch ?? null,
          state,
          pullRequest: pull?.number ?? null,
          certification,
          hours: /^\d+(?:\.\d+)?$/.test(hours) ? Number(hours) : null,
        })
      } else {
        drift.push({ code: 'lanes-row', line: row.line, detail: row.text })
      }
    }
  }
  return lanes
}
