import { developerHardwareCorpus } from './helpers/hardwareCorpus'
import { describe, expect, it } from 'vitest'
import { hardwareAction, isHardwareStop } from '../../src/core/maker/guard/hardwareCommands'
import { parseShell, type GuardDialect } from '../../src/core/maker/guard/shellParse'
import { PermissionEngine } from '../../src/core/backends/modelapi/permissions'

const HTTP = 'http:'
const machine = {
  targets: [{ address: `${HTTP}//printer.local`, stop: '/printer/emergency_stop' }],
}
const dialects: readonly GuardDialect[] = ['bash', 'powershell', 'cmd']

describe('REDM103G review regressions and fail-closed rules', () => {
  it.each(dialects)('F1: substitution never earns a stop exemption (%s)', (dialect) => {
    const substitutions: Readonly<Record<GuardDialect, string>> = {
      bash: `curl -X POST ${HTTP}//$(gpioset\${IFS}gpiochip0\${IFS}17=1)/printer/emergency_stop`,
      powershell: `curl -X POST "${HTTP}//$(gpioset gpiochip0 17=1)/printer/emergency_stop"`,
      cmd: `curl -X POST ${HTTP}//%MACHINE%/printer/emergency_stop`,
    }
    const line = substitutions[dialect]
    expect(isHardwareStop(line, dialect, machine)).toBe(false)
    expect(hardwareAction(line, dialect, machine)).toBe('actuate')
  })

  it.each(dialects)('F2: every transfer and body flag contributes (%s)', (dialect) => {
    for (const line of [
      `curl ${HTTP}//printer.local/printer/info --next -X POST -d script=G28 ${HTTP}//printer.local/printer/gcode/script`,
      `curl --json "{}" ${HTTP}//printer.local/api/printer/printhead`,
      `curl ${HTTP}//printer.local/printer/emergency_stop --next --json "{}" ${HTTP}//printer.local/api/job`,
      `curl -XPOST ${HTTP}//printer.local/printer/info ${HTTP}//printer.local/api/job`,
      `curl -K config.txt ${HTTP}//printer.local/printer/info`,
      `curl -T job.gcode ${HTTP}//printer.local/printer/info`,
      `curl --data-urlencode script=G28 ${HTTP}//printer.local/printer/info`,
      `wget --post-file=job.gcode ${HTTP}//printer.local/printer/info`,
      `http POST ${HTTP}//printer.local/api/job command=home`,
    ])
      expect(hardwareAction(line, dialect, machine)).toBe('actuate')
  })

  it('R2: RPC writes and websocket clients fail closed; exact read methods can observe', () => {
    expect(hardwareAction('wscat -c ws://printer.local/websocket', 'bash', machine)).toBe('actuate')
    expect(hardwareAction('curl --json "{}" https://printer.local/%70rinter/gcode/script')).toBe(
      'actuate',
    )
    expect(
      hardwareAction('curl --data script=%4d500 https://printer.local/%70rinter/gcode/script'),
    ).toBe('refused')
    expect(
      hardwareAction(
        `curl --json '{"method":"printer.info"}' ${HTTP}//printer.local/server/jsonrpc`,
        'bash',
        machine,
      ),
    ).toBe('observe')
    expect(
      hardwareAction(
        `curl --json '{"method":"printer.gcode.script","params":{"script":"G28"}}' ${HTTP}//printer.local/server/jsonrpc`,
        'bash',
        machine,
      ),
    ).toBe('actuate')
    expect(
      hardwareAction('wscat -c ws://printer.local/server/jsonrpc', 'bash', {
        targets: [{ address: 'ws://printer.local' }],
      }),
    ).toBe('actuate')
    expect(
      hardwareAction(
        `Invoke-WebRequest -Method GET -Body G28 ${HTTP}//printer.local/printer/info`,
        'powershell',
        machine,
      ),
    ).toBe('actuate')
    expect(
      hardwareAction(
        `Invoke-RestMethod -InFile job.gcode ${HTTP}//printer.local/printer/info`,
        'powershell',
        machine,
      ),
    ).toBe('actuate')
  })

  it.each([
    ['bash', String.raw`sh -c 'avrdude -p m328p -c usbasp -U lfuse\:w:0xff:m'`],
    ['bash', String.raw`sh -c 'espefuse.py burn\-key KEY0 key.bin'`],
    ['powershell', 'pwsh -Command \'avrdude -U "lfuse:w:0xff:m"\''],
    ['cmd', 'cmd /c "espefuse burn^-key KEY0 key.bin"'],
  ] as const)('F3: irreversible escaped/wrapped argv refused (%s)', (dialect, line) => {
    expect(hardwareAction(line, dialect)).toBe('refused')
  })

  it.each(dialects)('F4: serial, board and GPIO destinations are writes (%s)', (dialect) => {
    for (const line of [
      'printf G28 | tee /dev/ttyUSB0',
      'dd if=job.gcode of=/dev/ttyUSB0',
      'echo G28 > COM5',
      'echo 1 > /sys/class/gpio/gpio17/value',
      'stty -F /dev/ttyUSB0 115200; echo G28 > /dev/ttyUSB0',
    ])
      expect(hardwareAction(line, dialect), line).toBe('actuate')
    for (const line of [
      'echo x > /media/CIRCUITPY/code.py',
      'Set-Content -Path /media/CIRCUITPY/code.py -Value x',
      'Out-File -FilePath /Volumes/mbed/firmware.bin',
      'cp app.uf2 /media/RPI-RP2/app.uf2',
    ])
      expect(hardwareAction(line, dialect)).toBe('program')
    expect(hardwareAction('copy app.uf2 E:/app.uf2', dialect, { boardRoots: ['E:'] })).toBe(
      'program',
    )
  })

  it.each(dialects)('F8: only registered canonical stop is exempt (%s)', (dialect) => {
    const line = `curl -X POST "${HTTP}//printer.local/printer/emergency_stop"`
    expect(isHardwareStop(line, dialect, machine)).toBe(true)
    expect(isHardwareStop(line, dialect)).toBe(false)
    for (const suffix of [
      ' --json "{}"',
      ` --next ${HTTP}//printer.local/printer/info`,
      '?script=G28',
    ])
      expect(isHardwareStop(`${line.replace(/"$/, '')}${suffix}"`, dialect, machine)).toBe(false)
    expect(hardwareAction(line, dialect)).toBe('actuate')
  })

  it('F8: PowerShell canonical request and serial bytes use host registration', () => {
    expect(
      isHardwareStop(
        `Invoke-WebRequest -Method POST ${HTTP}//printer.local/printer/emergency_stop`,
        'powershell',
        machine,
      ),
    ).toBe(true)
    const serial = { targets: [{ address: '/dev/ttyUSB0', stop: 'M112\n' }] }
    expect(isHardwareStop("echo 'M112' > /dev/ttyUSB0", 'bash', serial)).toBe(true)
    expect(isHardwareStop("echo 'M112' > /dev/ttyUSB1", 'bash', serial)).toBe(false)
  })

  it.each(['bash', 'powershell'] as const)(
    'R1: unknown plus host-owned hardware signal asks once (%s)',
    (dialect) => {
      const engine = new PermissionEngine('onRequest')
      for (const command of [
        'node -e "run()"',
        'source setup.sh',
        'base64 -d payload | sh',
        'echo code > task.sh; sh task.sh',
        'echo gpioset > task.cmd; task.cmd',
        'echo gpioset > task; ./task',
        `curl -K config.txt ${HTTP}//printer.local/status`,
      ])
        expect(
          engine.judge({
            toolName: 'shell',
            toolClass: 'shell',
            command,
            dialect,
            hardware: { ...machine, isHardwareWorkspace: true },
          }),
        ).toMatchObject({
          verdict: 'ask',
          settledBy: 'hardwareDetected',
          hasSessionChoice: false,
          isReviewable: false,
        })
    },
  )

  it('R1: parser retains argument boundaries, redirection direction and pipes', () => {
    const shape = parseShell("printf 'G28 G1' | tee /dev/ttyUSB0 > result.log", 'bash')
    expect(shape.isUnknown).toBe(false)
    expect(shape.commands[0]).toEqual({
      argv: ['printf', 'G28 G1'],
      redirects: [],
      isPipeline: true,
    })
    expect(shape.commands[1]?.redirects).toEqual([{ operator: '>', target: 'result.log' }])
    expect(parseShell('echo %PORT%', 'cmd').isUnknown).toBe(true)
    expect(parseShell('echo "$PORT"', 'powershell').isUnknown).toBe(true)
    expect(parseShell('cat <<EOF\n/dev/ttyUSB0\nEOF', 'bash').isUnknown).toBe(true)
  })
})

describe('F9/F10/R6: ordinary developer false-positive corpus', () => {
  it.each(dialects)('zero hardware asks/refusals across corpus (%s)', (dialect) => {
    const errors = developerHardwareCorpus.filter((command) => {
      const action = hardwareAction(command, dialect)
      return action !== undefined && action !== 'observe' && action !== 'offline'
    })
    expect(errors).toEqual([])
  })
  it('reads a serial port as connect, never program/actuation', () => {
    expect(hardwareAction('cat < /dev/ttyUSB0')).toBe('connect')
    expect(hardwareAction('dd if=/dev/ttyUSB0 of=backup.bin')).toBeUndefined()
  })

  it('R4: literal irreversible payloads remain refused through a device-write pipeline', () => {
    expect(hardwareAction("printf 'M500' | tee /dev/ttyUSB0")).toBe('refused')
    expect(hardwareAction('tee log.txt /dev/ttyUSB0')).toBe('actuate')
    expect(
      hardwareAction(
        'Copy-Item -Path /media/CIRCUITPY/code.py -Destination backup.py',
        'powershell',
      ),
    ).toBeUndefined()
  })
})
