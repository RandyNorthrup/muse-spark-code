import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { posixQuoted, powerShellQuoted, terminalArgument } from '../../src/core/shellQuote'
import { WINDOWS_POWERSHELL_RELATIVE_PATH } from '../../src/shared/constants'

// Every character PowerShell reads as a single quote, and the shells' other
// specials, in one value.
const TRICKY = `O’Brien's ‘x’ ‚y‛ $HOME \`n "q" ; & | $(echo no)`

describe('powerShellQuoted', () => {
  it('doubles every character PowerShell reads as a single quote', () => {
    expect(powerShellQuoted("a'b")).toBe("'a''b'")
    expect(powerShellQuoted('O’Brien')).toBe("'O’’Brien'")
    expect(powerShellQuoted('‘x’‚y‛')).toBe("'‘‘x’’‚‚y‛‛'")
    expect(powerShellQuoted('plain $x')).toBe("'plain $x'")
  })

  // Windows may live on any drive: the path comes from %SystemRoot%, as in
  // the product, and the test is skipped where there is none.
  const systemRoot = process.env['SystemRoot']
  it.skipIf(process.platform !== 'win32' || systemRoot === undefined)(
    'round-trips through Windows PowerShell',
    () => {
      const powershell = path.win32.join(systemRoot ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH)
      // stdin closed: Windows PowerShell with -Command waits on an open pipe.
      const output = execFileSync(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write(${powerShellQuoted(TRICKY)})`,
        ],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      expect(output).toBe(TRICKY)
    },
  )
})

describe('posixQuoted', () => {
  it('closes, escapes and reopens around a single quote', () => {
    expect(posixQuoted("a'b")).toBe(String.raw`'a'\''b'`)
    expect(posixQuoted('$HOME `x`')).toBe("'$HOME `x`'")
  })

  it.skipIf(process.platform === 'win32')('round-trips through /bin/sh', () => {
    const output = execFileSync('/bin/sh', ['-c', `printf '%s' ${posixQuoted(TRICKY)}`], {
      encoding: 'utf8',
    })
    expect(output).toBe(TRICKY)
  })
})

describe('terminalArgument', () => {
  it('quotes for the shell the terminal is pinned to on each platform', () => {
    expect(terminalArgument("it's", 'win32')).toBe("'it''s'")
    expect(terminalArgument("it's", 'linux')).toBe(String.raw`'it'\''s'`)
    expect(terminalArgument("it's", 'darwin')).toBe(String.raw`'it'\''s'`)
  })
})
