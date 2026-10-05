// M97 lane R: the reserved `legal` command's arguments. The command is
// routed before prompt parsing, takes exactly the brief's flags, and answers
// anything else with the usage reason and exit 2.

import { describe, expect, it } from 'vitest'
import { isHeadlessCommand, parseCommandLine } from '../../src/runtime/cliArgs'
import { parseLegalArgs } from '../../src/runtime/legal/legalArgs'
import { LEGAL_PATH_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'

describe('M97 legal args (lane R)', () => {
  it('routes the reserved command with text, no file and no registry', () => {
    const command = parseCommandLine(['legal'])
    expect(command).toEqual({
      command: 'legal',
      options: { format: 'text', out: undefined, registry: false },
    })
    if (command.command !== 'legal') throw new Error('misrouted')
    expect(isHeadlessCommand(command)).toBe(true)
  })
  it('parses every flag', () => {
    const command = parseCommandLine([
      'legal',
      '--format',
      'json',
      '--out',
      'report.json',
      '--registry',
    ])
    expect(command).toEqual({
      command: 'legal',
      options: { format: 'json', out: 'report.json', registry: true },
    })
  })
  it('answers --help with the global help, like the other headless commands', () => {
    expect(parseCommandLine(['legal', '--help'])).toEqual({ command: 'help' })
  })
  it.each([['yaml'], ['TEXT'], ['']])('refuses --format %s with the format reason', (format) => {
    expect(parseLegalArgs({ format }, [])).toEqual({
      ok: false,
      reason: UI_TEXT.legalFormatInvalid,
    })
    const command = parseCommandLine(['legal', '--format', format])
    expect(command).toEqual({ command: 'invalid', reason: UI_TEXT.legalFormatInvalid, exitCode: 2 })
  })
  it('refuses a positional with the usage reason', () => {
    expect(parseLegalArgs({}, ['prompt'])).toEqual({ ok: false, reason: UI_TEXT.legalUsage })
    expect(parseCommandLine(['legal', 'scan就要'])).toEqual({
      command: 'invalid',
      reason: UI_TEXT.legalUsage,
      exitCode: 2,
    })
  })
  it.each(['', 'x'.repeat(LEGAL_PATH_MAX_CHARS + 1)])(
    'refuses --out %s with the usage reason',
    (out) => {
      expect(parseLegalArgs({ out }, [])).toEqual({ ok: false, reason: UI_TEXT.legalUsage })
    },
  )
  it('refuses an unknown flag with exit 2', () => {
    const command = parseCommandLine(['legal', '--nope'])
    expect(command.command).toBe('invalid')
    if (command.command !== 'invalid') throw new Error('misrouted')
    expect(command.exitCode).toBe(2)
  })
  it('leaves the other headless commands routed as before', () => {
    expect(parseCommandLine(['exec', 'hi']).command).toBe('exec')
    expect(parseCommandLine(['scan-secrets', 'file']).command).toBe('scan-secrets')
    expect(parseCommandLine([]).command).toBe('serve')
  })
})
