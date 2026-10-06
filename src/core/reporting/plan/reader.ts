import type { PlanFacts, PlanMilestone, ReportQuestion } from '../sources/types'
import { REPORT_PLAN_MAX_BYTES } from '../../../shared/constants'
import {
  compact,
  comparePlanText,
  field,
  milestoneHeading,
  milestoneIds,
  deliveryNeeds,
  PLAN_SECTIONS,
  planLines,
  requiredGates,
  tableCells,
  planTables,
  scrubPlanStrings,
  type PlanLine,
} from './grammar'
import { readLanes, type PlanEvidence } from './lanes'
import { readLedger, type QualityLedger } from './ledger'
import { STATUS_PHRASES } from './statusPhrases'

export interface PlanReadResult {
  readonly facts: PlanFacts
  readonly sections: readonly {
    readonly number: number
    readonly title: string
    readonly line: number
  }[]
  readonly decisions: readonly {
    readonly id: string
    readonly title: string
    readonly line: number
  }[]
  readonly ledger: QualityLedger | null
}
interface Drift {
  code: string
  line: number
  detail: string
}

function ledgerFence(text: string): { json: string; line: number; closed: boolean }[] {
  const blocks: { json: string; line: number; closed: boolean }[] = []
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  let fence: { marker: string; length: number; start: number; ledger: boolean } | undefined
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index] ?? '')
    if (!match?.[1]) continue
    if (fence) {
      if (
        match[1].startsWith(fence.marker) &&
        match[1].length >= fence.length &&
        !match[2]?.trim()
      ) {
        if (fence.ledger)
          blocks.push({
            json: lines.slice(fence.start + 1, index).join('\n'),
            line: fence.start + 1,
            closed: true,
          })
        fence = undefined
      }
    } else
      fence = {
        marker: match[1][0] ?? '',
        length: match[1].length,
        start: index,
        ledger: match[2]?.trim() === 'quality-ledger',
      }
  }
  if (fence?.ledger) blocks.push({ json: '', line: fence.start + 1, closed: false })
  return blocks
}

function milestone(
  body: readonly PlanLine[],
  id: string,
  title: string,
  evidence: PlanEvidence,
  drift: Drift[],
  line: number,
  knownIds: ReadonlyMap<string, string>,
): PlanMilestone | null {
  const statuses: { date: string; status: PlanMilestone['status']; note: string }[] = []
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    if (!row || !/^(?:- )?\*\*Status /.test(row.text)) continue
    let text = row.text.replace(/^- /, '')
    let hasClosingBold = text.includes('**', 2)
    while (!hasClosingBold && index + 1 < body.length) {
      index += 1
      const continuation = body[index]?.text ?? ''
      hasClosingBold = continuation.includes('**')
      text += `\n${continuation}`
    }
    const match = /^\*\*Status (\d{4}-\d{2}-\d{2})(?: \(([^]*?)\))?: ([^]*?)\*\*/.exec(text)
    if (!match?.[1] || !match[3]) {
      drift.push({ code: 'status-form', line: row.line, detail: id })
      continue
    }
    const phrase = compact(match[3]).replace(/\.$/, '')
    const status = Object.hasOwn(STATUS_PHRASES, phrase) ? STATUS_PHRASES[phrase] : undefined
    if (!status) {
      drift.push({ code: 'status-phrase', line: row.line, detail: `${id}: ${phrase}` })
      continue
    }
    statuses.push({ date: match[1], status, note: match[2] ?? '' })
  }
  if (statuses.length === 0) {
    drift.push({ code: 'milestone-status', line, detail: id })
    return null
  }
  const current = statuses.find(({ note }) => !/historical|superseded/.test(note)) ?? statuses[0]
  if (!current) return null
  const checklist: { text: string; done: boolean }[] = []
  for (let index = 0; index < body.length; index += 1) {
    const match = /^\s*- \[([ xX])\] (.+)$/.exec(body[index]?.text ?? '')
    if (!match?.[2]) continue
    let text = match[2]
    while (
      /^\s+\S/.test(body[index + 1]?.text ?? '') &&
      !/^\s*- \[/.test(body[index + 1]?.text ?? '')
    ) {
      index += 1
      text += ` ${body[index]?.text.trim() ?? ''}`
    }
    checklist.push({ text, done: match[1]?.toLowerCase() === 'x' })
  }
  return {
    id,
    title,
    status: current.status,
    date: current.date,
    goal: field(body, 'Goal'),
    dependencies: milestoneIds(field(body, 'Depends on'), knownIds),
    requiredGates: requiredGates(field(body, 'Gates')),
    lanes: readLanes(body, id, evidence, drift),
    checklist,
  }
}

function deliveryOrder(
  body: readonly PlanLine[],
  drift: Drift[],
  knownIds: ReadonlyMap<string, string>,
): PlanFacts['deliveryOrder'] {
  const result: { id: string; needs: string[]; reason: string }[] = []
  let expected = 1
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    if (!row || !/^(?:\d+[.)]\s|[-*+]\s|\*\*(?:M\d|\d+\.\d))/.test(row.text)) continue
    let text = row.text
    while (
      index + 1 < body.length &&
      !/^(?:\d+[.)]\s|[-*+]\s|\*\*(?:M\d|\d+\.\d)|### )/.test(body[index + 1]?.text ?? '')
    ) {
      index += 1
      text += ` ${body[index]?.text.trim() ?? ''}`
    }
    const match = /^(\d+)\. \*\*(.+?)\*\*(?: \([^]*?\))? — (.+?)\s+Needs: (.+)\.$/.exec(
      compact(text),
    )
    if (!match?.[2] || !match[3] || !match[4] || Number(match[1]) !== expected) {
      drift.push({ code: 'delivery-form', line: row.line, detail: compact(text) })
    } else {
      const label = match[2]
      // A versioned release train is one entry; its component milestones remain in the reason.
      const id = /^(?:M\d+[a-z\d]*|\d+\.\d+\.\d+)/i.exec(label)?.[0] ?? label
      const primaryNeeds = match[4].split(';', 1)[0]?.split(/ for | with | whose /, 1)[0] ?? ''
      const needs = deliveryNeeds(primaryNeeds, knownIds)
      if (needs === null) drift.push({ code: 'delivery-needs', line: row.line, detail: match[4] })
      else result.push({ id, needs, reason: `${match[3]} Needs: ${match[4]}.` })
    }
    expected += 1
  }
  return result
}

function questions(
  body: readonly PlanLine[],
  knownIds: ReadonlyMap<string, string>,
): ReportQuestion[] {
  const result: ReportQuestion[] = []
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    const match = /^(?:- \*\*|### )(Q-[\w-]+)(?=[\s:—])/.exec(row?.text ?? '')
    if (!match?.[1]) continue
    const start = index
    while (index + 1 < body.length && !/^(?:- \*\*Q-|### Q-)/.test(body[index + 1]?.text ?? ''))
      index += 1
    const text = body
      .slice(start, index + 1)
      .map(({ text }) => text)
      .join('\n')
      .trim()
    result.push({
      id: match[1],
      text,
      milestoneIds: milestoneIds(text, knownIds),
      state: /\*\*(?:Resolved|Answered|Decided|Owner answer)(?:\s|[:.]|\*)/i.test(text)
        ? 'answered'
        : 'open',
    })
  }
  return result
}

function releases(body: readonly PlanLine[]): PlanFacts['releases'] {
  const records: { version: string; date: string; text: string }[] = []
  for (let index = 0; index < body.length; index += 1) {
    const text = body[index]?.text ?? ''
    const heading = /^### v?(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/.exec(text)
    const bold =
      /^\*\*v?(\d+\.\d+\.\d+)(?: (?:released|preparation))? \((?:published )?(\d{4}-\d{2}-\d{2})(?:, [^)]*)?\)/.exec(
        text,
      )
    const initial = /^\*\*Status (\d{4}-\d{2}-\d{2}):\*\*/.exec(text)
    const date = heading?.[2] ?? bold?.[2] ?? initial?.[1]
    if (!date) continue
    const start = index
    while (
      index + 1 < body.length &&
      !/^(?:### |\*\*(?:v?\d+\.\d+\.\d+|Towards |Status ))/.test(body[index + 1]?.text ?? '')
    )
      index += 1
    const recordText = body
      .slice(start, index + 1)
      .map(({ text }) => text)
      .join('\n')
      .trim()
    const version =
      heading?.[1] ?? bold?.[1] ?? (initial ? /\bv(\d+\.\d+\.\d+)\b/.exec(recordText)?.[1] : null)
    if (version) records.push({ version, date, text: recordText })
  }
  return records
}

/** Pure parser. Decode and scrub every returned string; R scrubs each rendered output again. */
export function readPlan(text: string, evidence: PlanEvidence = {}): PlanReadResult {
  const result = parsePlan(text, evidence)
  scrubPlanStrings(result)
  return result
}

function parsePlan(text: string, evidence: PlanEvidence): PlanReadResult {
  const empty: PlanFacts = {
    format: 'none',
    milestones: [],
    questions: [],
    risks: [],
    residuals: [],
    releases: [],
    deliveryOrder: [],
    drift: [],
  }
  if (
    text.length > REPORT_PLAN_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > REPORT_PLAN_MAX_BYTES
  )
    return {
      facts: {
        ...empty,
        drift: [
          {
            code: 'input-size',
            line: 1,
            detail: `maxUtf8Bytes=${String(REPORT_PLAN_MAX_BYTES)}`,
          },
        ],
      },
      sections: [],
      decisions: [],
      ledger: null,
    }
  const ledgers = ledgerFence(text)
  if (ledgers.length > 0) {
    const block = ledgers[0]
    if (ledgers.length !== 1 || !block?.closed)
      return {
        facts: {
          ...empty,
          format: 'quality-ledger-v1',
          drift: [{ code: 'ledger-fence', line: block?.line ?? 1, detail: 'quality-ledger' }],
        },
        sections: [],
        decisions: [],
        ledger: null,
      }
    return { ...readLedger(block.json, block.line), sections: [], decisions: [] }
  }
  const lines = planLines(text)
  const sections: { number: number; title: string; line: number }[] = []
  const decisions: { id: string; title: string; line: number }[] = []
  const milestones: PlanMilestone[] = []
  const drift: Drift[] = []
  const sectionBodies = new Map<number, PlanLine[]>()
  const knownIds = new Map<string, string>()
  const headings: number[] = []
  // One index pass; each milestone body is visited only within its own boundaries.
  for (const [index, row] of lines.entries()) {
    if (/^#{2,3} /.test(row.text)) headings.push(index)
    const item = milestoneHeading(row.text)
    if (item) knownIds.set(item.id.toLowerCase(), item.id)
  }
  const seenSections = new Set<number>()
  const seenMilestones = new Set<string>()
  let nextHeading = 0
  let section = 0
  let delivery: PlanFacts['deliveryOrder'] = []
  for (let index = 0; index < lines.length; index += 1) {
    const row = lines[index]
    if (!row) continue
    while ((headings[nextHeading] ?? lines.length) <= index) nextHeading += 1
    const end = headings[nextHeading] ?? lines.length
    const heading = /^## (\d+)\. (.+)$/.exec(row.text)
    if (heading?.[1] && heading[2]) {
      section = Number(heading[1])
      if (seenSections.has(section))
        drift.push({ code: 'section-duplicate', line: row.line, detail: heading[1] })
      sections.push({ number: section, title: heading[2], line: row.line })
      seenSections.add(section)
      if (!sectionBodies.has(section)) sectionBodies.set(section, [])
      continue
    }
    sectionBodies.get(section)?.push(row)
    const decision = /^### (D\d+(?:[a-z]|\.\d+)?) — (.+)$/.exec(row.text)
    if (decision?.[1] && decision[2])
      decisions.push({ id: decision[1], title: decision[2], line: row.line })
    const item = milestoneHeading(row.text)
    if (item) {
      if (section !== PLAN_SECTIONS.milestones) {
        drift.push({ code: 'milestone-section', line: row.line, detail: item.id })
        continue
      }
      const parsed = milestone(
        lines.slice(index + 1, end),
        item.id,
        item.title,
        evidence,
        drift,
        row.line,
        knownIds,
      )
      if (parsed) {
        if (seenMilestones.has(parsed.id.toLowerCase()))
          drift.push({ code: 'milestone-duplicate', line: row.line, detail: parsed.id })
        milestones.push(parsed)
        seenMilestones.add(parsed.id.toLowerCase())
      }
    } else if (section === PLAN_SECTIONS.milestones && row.text.startsWith('### ')) {
      if (/^### Delivery order(?: \(\d{4}-\d{2}-\d{2}\))?$/.test(row.text)) {
        delivery = deliveryOrder(lines.slice(index + 1, end), drift, knownIds)
      } else if (!/^### 6\.0 Standard certification checklist(?: \(.+\))?$/.test(row.text))
        drift.push({ code: 'milestone-heading', line: row.line, detail: row.text })
    } else if (section === PLAN_SECTIONS.milestones && row.text === '**Delivery order**') {
      delivery = deliveryOrder(lines.slice(index + 1, end), drift, knownIds)
    }
  }
  if (
    !sectionBodies.has(PLAN_SECTIONS.milestones) &&
    lines.every(({ text }) => !milestoneHeading(text))
  )
    return { facts: empty, sections, decisions, ledger: null }
  const risks: { id: string; text: string; milestoneIds: string[] }[] = []
  const riskRows = sectionBodies.get(PLAN_SECTIONS.risks) ?? []
  for (const { rows } of planTables(riskRows, drift))
    for (const row of rows) {
      const cells = tableCells(row.text)
      if (!cells[0]) continue
      const text = cells.join(' | ')
      risks.push({
        id: cells.slice(0, 2).join(': '),
        text,
        milestoneIds: milestoneIds(text, knownIds),
      })
    }
  const residualLines = sectionBodies.get(PLAN_SECTIONS.residuals) ?? []
  const residuals: { id: string; text: string }[] = []
  for (let index = 0; index < residualLines.length; index += 1) {
    if (!residualLines[index]?.text.startsWith('- ')) continue
    const start = index
    while (index + 1 < residualLines.length && !residualLines[index + 1]?.text.startsWith('- '))
      index += 1
    const text = residualLines
      .slice(start, index + 1)
      .map(({ text }) => text)
      .join('\n')
      .trim()
    residuals.push({
      id: /^- \*\*([^*]+)\*\*/.exec(text)?.[1] ?? residualLines[start]?.text.slice(2) ?? '',
      text,
    })
  }
  return {
    facts: {
      format: 'plan-format-v1',
      milestones,
      questions: questions(sectionBodies.get(PLAN_SECTIONS.questions) ?? [], knownIds),
      risks,
      residuals,
      releases: releases(sectionBodies.get(PLAN_SECTIONS.releases) ?? []),
      deliveryOrder: delivery,
      drift: drift.toSorted((a, b) => a.line - b.line || comparePlanText(a.code, b.code)),
    },
    sections,
    decisions,
    ledger: null,
  }
}
