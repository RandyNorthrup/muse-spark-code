import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hardwareAction, isHardwareStop } from '../../src/core/maker/guard/hardwareCommands'
import { parseShell } from '../../src/core/maker/guard/shellParse'

const HTTP = 'http:'

describe('REDM103G fake-only native shell probes', () => {
  it('POSIX: real escaping and substitution agree with the guard; commands are fake functions', () => {
    const line = String.raw`bash -c 'avrdude -U lfuse\:w:0xff:m'`
    expect(hardwareAction(line)).toBe('refused')
    const attack = `curl -X POST ${HTTP}//$(gpioset\${IFS}gpiochip0\${IFS}17=1)/printer/emergency_stop`
    expect(isHardwareStop(attack)).toBe(false)
    expect(hardwareAction(attack)).toBe('actuate')
    const bash =
      process.platform === 'win32'
        ? path.resolve(
            execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
            '../../..',
            'bin/bash.exe',
          )
        : '/bin/bash'
    const probe = spawnSync(
      bash,
      [
        '--noprofile',
        '--norc',
        '-c',
        [
          String.raw`avrdude() { printf "<avr>%s\n" "$*"; }`,
          String.raw`curl() { printf "<curl>%s\n" "$*"; }`,
          String.raw`gpioset() { printf "<gpio>%s\n" "$*" >&2; printf printer.local; }`,
          'export -f avrdude curl gpioset',
          line,
          attack,
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    )
    expect(probe.status, probe.stderr).toBe(0)
    expect(probe.stdout).toContain('<avr>-U lfuse:w:0xff:m')
    expect(probe.stdout).toContain(`<curl>-X POST ${HTTP}//printer.local/printer/emergency_stop`)
    expect(probe.stderr).toContain('<gpio>gpiochip0 17=1')
  })

  it('PowerShell: real native command/argument parsing agrees; HTTP/device calls are fake functions', () => {
    const line = `Invoke-WebRequest -Method POST ${HTTP}//printer.local/printer/emergency_stop`
    expect(parseShell(line, 'powershell').isUnknown).toBe(false)
    expect(
      isHardwareStop(line, 'powershell', {
        targets: [{ address: `${HTTP}//printer.local`, stop: '/printer/emergency_stop' }],
      }),
    ).toBe(true)
    expect(hardwareAction('Set-Content -Path COM5 -Value G28', 'powershell')).toBe('actuate')
    if (process.platform !== 'win32') return
    const probe = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          'function Invoke-WebRequest { param($Method,$Uri) Write-Output ("<http>" + $Method + " " + $Uri) }',
          'function Set-Content { param($Path,$Value) Write-Output ("<serial>" + $Path + " " + $Value) }',
          line,
          'Set-Content -Path COM5 -Value G28',
        ].join('; '),
      ],
      { encoding: 'utf8' },
    )
    expect(probe.status, probe.stderr).toBe(0)
    expect(probe.stdout).toContain(`<http>POST ${HTTP}//printer.local/printer/emergency_stop`)
    expect(probe.stdout).toContain('<serial>COM5 G28')
  })

  it('cmd: real caret decoding agrees; device executable is a temporary echo-only batch file', () => {
    const line = 'avrdude -U lfuse^:w:0xff:m'
    expect(parseShell(line, 'cmd').commands[0]?.argv).toEqual(['avrdude', '-U', 'lfuse:w:0xff:m'])
    expect(hardwareAction(line, 'cmd')).toBe('refused')
    if (process.platform !== 'win32') return
    const root = path.resolve('temp')
    mkdirSync(root, { recursive: true })
    const folder = mkdtempSync(path.join(root, 'redm103g-shell-'))
    if (!path.resolve(folder).startsWith(`${root}${path.sep}`))
      throw new Error('Probe directory escaped the worktree')
    try {
      writeFileSync(path.join(folder, 'avrdude.cmd'), '@echo off\r\necho ^<avr^>%*\r\n')
      const probe = spawnSync(
        'cmd.exe',
        ['/d', '/s', '/c', String.raw`.\avrdude.cmd -U lfuse^:w:0xff:m`],
        {
          cwd: folder,
          encoding: 'utf8',
        },
      )
      expect(probe.status, probe.stderr).toBe(0)
      expect(probe.stdout).toContain('<avr>-U lfuse:w:0xff:m')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
