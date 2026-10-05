// The `muse-team-report` contract (M96 lane W, acceptance 18): a valid
// block parses, a missing or invalid one becomes `unstructured` clipped,
// `blocked` carries its questions, and a review's findings use M70's shape.

import { describe, expect, it } from 'vitest'
import {
  clipReportSummary,
  extractReviewFindings,
  extractTeamReport,
  lastFencedBlock,
} from '../../src/core/team/workers/report'
import { WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS } from '../../src/shared/constants'

function block(json: string): string {
  return ['All green.', '```muse-team-report', json, '```'].join('\n')
}

describe('extractTeamReport', () => {
  it('parses a valid block with every field', () => {
    const outcome = extractTeamReport(
      block(
        JSON.stringify({
          status: 'done',
          summary: 'Added the parser.',
          files: ['src/a.ts'],
          checks: ['npm run quality'],
          sources: ['https://example.com'],
          questions: [],
          next: 'Wire it up.',
        }),
      ),
    )
    expect(outcome).toEqual({
      ok: true,
      report: {
        status: 'done',
        summary: 'Added the parser.',
        files: ['src/a.ts'],
        checks: ['npm run quality'],
        sources: ['https://example.com'],
        questions: [],
        next: 'Wire it up.',
      },
    })
  })

  it('parses a minimal block and keeps blocked questions', () => {
    const outcome = extractTeamReport(
      block(JSON.stringify({ status: 'blocked', summary: 'Stuck.', questions: ['Ship it?'] })),
    )
    expect(outcome).toEqual({
      ok: true,
      report: { status: 'blocked', summary: 'Stuck.', questions: ['Ship it?'] },
    })
  })

  it('takes the last block when the message holds two', () => {
    const text = [
      block(JSON.stringify({ status: 'partial', summary: 'Draft.' })),
      'Revised after the checks.',
      block(JSON.stringify({ status: 'done', summary: 'Final.' })),
    ].join('\n')
    const outcome = extractTeamReport(text)
    expect(outcome).toEqual({ ok: true, report: { status: 'done', summary: 'Final.' } })
  })

  it('reports unstructured when the block is missing', () => {
    expect(extractTeamReport('Just some prose.')).toEqual({
      ok: false,
      status: 'unstructured',
      summary: 'Just some prose.',
    })
  })

  it('reports unstructured when the block is not JSON', () => {
    expect(extractTeamReport(block('{ nope'))).toEqual({
      ok: false,
      status: 'unstructured',
      summary: clipReportSummary(block('{ nope')),
    })
  })

  it('reports unstructured without zod when the shape is wrong', () => {
    const outcome = extractTeamReport(
      block(JSON.stringify({ status: 'shipped', summary: 'Wrong status.' })),
    )
    if (outcome.ok) {
      throw new Error('expected an unstructured outcome')
    }
    expect(outcome.status).toBe('unstructured')
  })

  it('clips a long unstructured summary', () => {
    const long = `x${'y'.repeat(WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS + 10)}`
    const outcome = extractTeamReport(long)
    if (outcome.ok) {
      throw new Error('expected an unstructured outcome')
    }
    expect(outcome.summary).toHaveLength(WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS + 1)
    expect(outcome.summary.endsWith('…')).toBe(true)
  })
})

describe('lastFencedBlock', () => {
  it('ignores an unclosed fence', () => {
    expect(lastFencedBlock('```muse-team-report\n{"a":1}', 'muse-team-report')).toBeUndefined()
  })

  it('ignores a block with another tag', () => {
    expect(lastFencedBlock('```json\n{"a":1}\n```', 'muse-team-report')).toBeUndefined()
  })
})

describe('extractReviewFindings', () => {
  it('parses a muse-review block in M70 shape', () => {
    const text = [
      'Reviewed.',
      '```muse-review',
      JSON.stringify({ findings: [{ file: 'src/a.ts', line: 3, title: 'Nit' }] }),
      '```',
    ].join('\n')
    expect(extractReviewFindings(text)).toEqual([{ file: 'src/a.ts', line: 3, title: 'Nit' }])
  })

  it('returns undefined when no review block is present', () => {
    expect(extractReviewFindings('No findings block.')).toBeUndefined()
  })

  it('returns undefined when the review block is malformed', () => {
    expect(extractReviewFindings('```muse-review\n{ nope\n```')).toBeUndefined()
  })
})
