// RLF-ACPHONEST B3 (RLF-HARVEST H8): the resource failure reporter names the
// reading and the cause's kind. The 0.19.0 reporter dropped the error and
// said the bare sentence; the reading prefix landed on int, and this lane
// adds the kind (a machine code or error name, never free text).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { ResourceReadingError, resourceFailureReporter } from '../../src/runtime/resources/text'

function reported(error: unknown): string[] {
  const lines: string[] = []
  resourceFailureReporter({
    warn: (message) => {
      lines.push(message)
    },
  })(error)
  return lines
}

describe('resource failure reporter', () => {
  it('names the reading and the fault behind the wrapper', () => {
    let failure: unknown
    try {
      JSON.parse('{"damaged": tru')
    } catch (error: unknown) {
      failure = error
    }
    const lines = reported(new ResourceReadingError('resources.settings', { cause: failure }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('resources.settings')
    expect(lines[0]).toContain('SyntaxError')
    expect(lines[0]).not.toContain('{"damaged"')
  })

  it('names a machine code the fault carries', () => {
    let failure: unknown
    try {
      readFileSync('/nonexistent-acphonest-reading-probe/settings.json')
    } catch (error: unknown) {
      failure = error
    }
    const lines = reported(new ResourceReadingError('resources.history', { cause: failure }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('resources.history')
    expect(lines[0]).toContain('ENOENT')
    expect(lines[0]).not.toContain('nonexistent-acphonest-reading-probe')
  })

  it('never repeats the plain sentence as its own cause', () => {
    const lines = reported(new ResourceReadingError('resources.status'))
    expect(lines).toEqual([`resources.status: ${EN.resourceUnavailable}`])
  })

  it('reports each reading once', () => {
    const lines: string[] = []
    const report = resourceFailureReporter({
      warn: (message) => {
        lines.push(message)
      },
    })
    report(new ResourceReadingError('resources.sample'))
    report(new ResourceReadingError('resources.sample'))
    expect(lines).toHaveLength(1)
  })
})
