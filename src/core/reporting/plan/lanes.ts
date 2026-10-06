import type { GitFacts, PlanLane } from '../sources/types'
import { tableCells, isTableSeparator, comparePlanText, type PlanLine } from './grammar'

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
])

function shortRef(name: string): string {
  return name
    .replace(/^refs\/(?:heads|remotes)\//, '')
    .replace(/^remotes\//, '')
    .replace(/^[^/]+\/(?=(?:feature\/|m\d+\/))/, '')
    .toLowerCase()
}

export function readLanes(
  body: readonly PlanLine[],
  milestoneId: string,
  evidence: PlanEvidence,
  drift: { code: string; line: number; detail: string }[],
): PlanLane[] {
  const lanes: PlanLane[] = []
  for (let index = 0; index < body.length; index += 1) {
    const header = body[index]
    if (!header || !/^\| Lane(?:\s|\s*\|)/.test(header.text)) continue
    const columns = tableCells(header.text)
    if (
      columns.some((column) => !LANE_COLUMNS.has(column)) ||
      new Set(columns).size !== columns.length ||
      !isTableSeparator(body[index + 1]?.text ?? '')
    ) {
      drift.push({ code: 'lanes-columns', line: header.line, detail: columns.join(' | ') })
      continue
    }
    index += 2
    let row = body[index]
    while (row?.text.startsWith('|')) {
      const cells = tableCells(row.text)
      if (cells.length !== columns.length) {
        drift.push({ code: 'lanes-row', line: row.line, detail: row.text })
      } else if (!isTableSeparator(row.text)) {
        const cell = (name: string) => cells[columns.indexOf(name)] ?? ''
        const id = (cells[0] ?? '').replaceAll(/[*`]/g, '').split(/\s+/, 1)[0] ?? ''
        const prefix = milestoneId.toLowerCase()
        const laneIds = id === '0' ? ['0', 'l0'] : [id.toLowerCase()]
        const isLaneBranch = (name: string) => {
          const ref = shortRef(name)
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
        const branch = branches[0]
        const pull = (evidence.pullRequests ?? [])
          .filter((pull) => isLaneBranch(pull.branch) && pull.state === 'open')
          .toSorted((a, b) => a.number - b.number)[0]
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
            cell('Items') || cell('Scope') || cell('Owns') || cell('Muse implementation ownership'),
          branch: branch?.name ?? pull?.branch ?? null,
          state,
          pullRequest: pull?.number ?? null,
          certification,
          hours: /^\d+(?:\.\d+)?$/.test(hours) ? Number(hours) : null,
        })
      }
      index += 1
      row = body[index]
    }
    index -= 1
  }
  return lanes
}
