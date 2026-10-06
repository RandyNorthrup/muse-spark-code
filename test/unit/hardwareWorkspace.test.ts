import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APPROVAL_MODES } from '../../src/shared/permissionModes'
import { PermissionEngine } from '../../src/core/backends/modelapi/permissions'
import {
  isHardwareWorkspace,
  isReadOnlyHardwareCommand,
  READ_ONLY_HARDWARE_COMMANDS,
} from '../../src/core/maker/guard/shellPolicy'
import type { GuardDialect } from '../../src/core/maker/guard/shellParse'
import { hardwareAction } from '../../src/core/maker/guard/hardwareCommands'
import { developerHardwareCorpus } from './helpers/hardwareCorpus'

const dialects: readonly GuardDialect[] = ['bash', 'powershell', 'cmd']
const hardware = { isHardwareWorkspace: true }

describe('REDM103G2 hardware workspace admission, independent of classifier', () => {
  it.each([
    { isMakerEnabled: true },
    { isHardwareProject: true },
    { hasConnectedBoard: true },
    { targets: [{ address: 'COM5' }] },
    { targets: [{ address: 'https://printer.local' }] },
    { boardRoots: ['E:'] },
    hardware,
  ])('host-owned signal makes a hardware workspace: %j', (context) => {
    expect(isHardwareWorkspace(context)).toBe(true)
    expect(
      new PermissionEngine('onRequest').judge({
        toolName: 'bash',
        toolClass: 'shell',
        command: 'npm test',
        hardware: context,
      }),
    ).toMatchObject({ verdict: 'ask', settledBy: 'hardwareDetected', hasSessionChoice: false })
  })

  it('empty inventory and false signals preserve ordinary workspaces', () => {
    expect(isHardwareWorkspace({ targets: [], boardRoots: [], isMakerEnabled: false })).toBe(false)
  })
  it('hardware host origin refuses even exact offline help without a model query flag', () => {
    expect(
      new PermissionEngine('promptUnmatched').judge({
        toolName: 'shell',
        toolClass: 'shell',
        command: 'esptool --help',
        hardware: { ...hardware, isUnattended: true },
      }),
    ).toMatchObject({ verdict: 'deny', settledBy: 'hardwareDetected' })
  })

  it.each(APPROVAL_MODES)('hardware shell ignores standing grants and reviewer in %s', (mode) => {
    const engine = new PermissionEngine(mode)
    engine.allowForSession('bash', 'npm test')
    expect(
      engine.judge({ toolName: 'bash', toolClass: 'shell', command: 'npm test', hardware }),
    ).toMatchObject({
      verdict: mode === 'allowAll' ? 'deny' : 'ask',
      settledBy: 'hardwareDetected',
      hasSessionChoice: false,
      isReviewable: false,
    })
    expect(
      engine.judge({
        toolName: 'bash',
        toolClass: 'shell',
        command: 'git status',
        hardware,
        isUnattended: true,
      }),
    ).toMatchObject({ verdict: 'deny', settledBy: 'hardwareDetected' })
  })

  for (const dialect of dialects) {
    it.each([
      ['R1F1 stop substitution', 'curl -X POST http://$(gpioset)/printer/emergency_stop'],
      [
        'R1F2 HTTP masking',
        'curl https://printer.local/printer/info --next --json "{}" https://printer.local/api/job',
      ],
      ['R1F3 shell wrapper', 'sh -c "gpioset gpiochip0 17=1"'],
      ['R1F4 serial write', 'printf G28 | tee /dev/ttyUSB0'],
      ['R1F9 documentation', 'echo "espefuse burn-key KEY0 key.bin"'],
      ['R2F1 env wrapper', 'env gpioset gpiochip0 17=1'],
      ['R2F1 command wrapper', 'command gpioset gpiochip0 17=1'],
      ['R2F1 process wrapper', 'Start-Process gpioset -ArgumentList "gpiochip0,17=1"'],
      ['R2F1 alias', 'Set-Alias x gpioset; x gpiochip0 17=1'],
      ['R2F1 PATH assignment', 'PATH=/tmp/tools gpioset gpiochip0 17=1'],
      [
        'R2F1 same-command script',
        'printf "gpioset gpiochip0 17=1" | tee task; chmod +x task; ./task',
      ],
      ['R2F2 variable tool', 'arduino-cli "$ACTION"'],
      ['R2F2 west variable', 'west "$ACTION"'],
      ['R2F2 STM32 variable', 'STM32_Programmer_CLI %ARGS%'],
      ['R2F3 PIO global flag', 'pio --no-ansi run -t upload'],
      ['R2F3 PIO test global flag', 'pio --no-ansi test'],
      ['R2F4 positional board path', 'Set-Content E:/code.py x'],
      ['R2F4 colon board path', 'Set-Content -Path:E:/code.py -Value:x'],
      ['R2F4 equal destination', 'cp --target-directory=/media/CIRCUITPY app.uf2'],
      ['R2F4 trailing flag', 'cp app.uf2 /media/CIRCUITPY -f'],
      ['R2F5 schemeless HTTP', 'curl -d script=G28 printer.local/printer/gcode/script'],
      [
        'R2F5 colon HTTP',
        'Invoke-WebRequest -Method:POST -Body:script=G28 -Uri:https://printer.local/printer/gcode/script',
      ],
      ['R2F6 encoded interpreter', 'pwsh -EncodedCommand ZQBjAGgAbwA='],
      ['R2F6 node interpreter', 'node -e "run()"'],
      ['classifier miss arbitrary binary', 'unknown-device-command --anything'],
    ])('%s asks exactly once in hardware (' + dialect + ')', (_name, command) => {
      const engine = new PermissionEngine('onRequest')
      engine.allowForSession('bash', command)
      expect(isReadOnlyHardwareCommand(command, dialect, hardware)).toBe(false)
      expect(
        engine.judge({ toolName: 'bash', toolClass: 'shell', command, dialect, hardware }),
      ).toMatchObject({
        verdict: 'ask',
        settledBy: 'hardwareDetected',
        hasSessionChoice: false,
        isReviewable: false,
      })
    })
  }
})

describe('one read-only hardware allowlist, exact argv only', () => {
  it.each(READ_ONLY_HARDWARE_COMMANDS)('row $argv admits only its exact shape', (row) => {
    // File rows use a real regular workspace file, never a fixture device.
    const command = [...row.argv, ...(row.workspaceFile ? ['README.md'] : [])].join(' ')
    for (const dialect of row.dialects) {
      const context = { ...hardware, workspaceRoot: process.cwd() }
      expect(isReadOnlyHardwareCommand(command, dialect, context)).toBe(true)
      expect(
        new PermissionEngine('promptUnmatched').judge({
          toolName: 'shell',
          toolClass: 'shell',
          command,
          dialect,
          hardware: context,
        }),
      ).toMatchObject({ verdict: 'allow', hasSessionChoice: false })
      expect(isReadOnlyHardwareCommand('x' + command, dialect, context)).toBe(false)
      expect(isReadOnlyHardwareCommand(command + 'x', dialect, context)).toBe(false)
      expect(isReadOnlyHardwareCommand(command + ' --evil', dialect, context)).toBe(false)
      for (const mutation of ['x' + command, command + 'x'])
        expect(
          new PermissionEngine('onRequest').judge({
            toolName: 'shell',
            toolClass: 'shell',
            command: mutation,
            dialect,
            hardware: context,
          }),
        ).toMatchObject({
          verdict: 'ask',
          isReviewable: false,
          hasSessionChoice: false,
        })
    }
  })
  it.each(dialects)(
    'compositions, expansions, redirections, aliases and wrappers ask (%s)',
    (dialect) => {
      for (const command of [
        'git status; git status',
        'git status && git status',
        'git status | cat',
        'git status > result',
        'git status < input',
        'git status # ignored',
        'git status\n',
        '$GIT status',
        '%GIT% status',
        'env git status',
        'command git status',
        'git -c alias.status=upload status',
        'git --exec-path=/tmp status',
        'sh -c "git status"',
        'git st',
        'git status --short=$ARGS',
        'git status $(gpioset)',
      ])
        expect(isReadOnlyHardwareCommand(command, dialect, hardware), command).toBe(false)
    },
  )
  it('workspace file reads reject traversal, devices, missing root and non-files', () => {
    for (const file of [
      '../README.md',
      '/dev/ttyUSB0',
      'COM5',
      'COM5.txt',
      'NUL.txt',
      '.',
      'missing-file',
    ])
      expect(
        isReadOnlyHardwareCommand('cat ' + file, 'bash', {
          ...hardware,
          workspaceRoot: process.cwd(),
        }),
      ).toBe(false)
    expect(isReadOnlyHardwareCommand('cat README.md', 'bash', hardware)).toBe(false)
  })
  it('a regular file behind a workspace symlink cannot earn a read exemption inside or outside the workspace', () => {
    const root = path.resolve('temp')
    mkdirSync(root, { recursive: true })
    const folder = mkdtempSync(path.join(root, 'hardware-read-'))
    if (!folder.startsWith(root + path.sep)) throw new Error('Fixture escaped the worktree')
    try {
      const workspace = path.join(folder, 'workspace')
      const outside = path.join(folder, 'outside')
      mkdirSync(workspace)
      mkdirSync(outside)
      writeFileSync(path.join(outside, 'file.txt'), 'ordinary file')
      symlinkSync(
        outside,
        path.join(workspace, 'link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      expect(
        isReadOnlyHardwareCommand('cat link/file.txt', 'bash', {
          ...hardware,
          workspaceRoot: workspace,
        }),
      ).toBe(false)
      symlinkSync(
        workspace,
        path.join(workspace, 'inside-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      writeFileSync(path.join(workspace, 'ordinary.txt'), 'ordinary file')
      expect(
        isReadOnlyHardwareCommand('cat inside-link/ordinary.txt', 'bash', {
          ...hardware,
          workspaceRoot: workspace,
        }),
      ).toBe(false)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('R2 classifier warnings and irreversible refusals', () => {
  it.each(dialects)('R2F1/F2/F3/F4/F5 labels retain literal evidence (%s)', (dialect) => {
    for (const command of [
      'env gpioset gpiochip0 17=1',
      'command gpioset gpiochip0 17=1',
      ...['arduino-cli', 'west', 'stm32_programmer_cli', 'stty'].map(
        (tool) => `${tool} ${dialect === 'cmd' ? '%ACTION%' : '"$ACTION"'}`,
      ),
      'curl -d script=G28 printer.local/printer/gcode/script',
      'Invoke-WebRequest -Method:POST -Body:script=G28 -Uri:https://printer.local/printer/gcode/script',
    ])
      expect(hardwareAction(command, dialect, hardware), command).toBe('actuate')
    for (const command of [
      'pio --no-ansi run -t upload',
      'platformio --no-color run --target upload',
      'pio --no-ansi test',
      'Set-Content E:/code.py x',
      'Add-Content E:/code.py x',
      'Out-File E:/code.py -InputObject x',
      'Set-Content -Path:E:/code.py -Value:x',
      'cp --target-directory=/media/CIRCUITPY app.uf2',
      'cp app.uf2 /media/CIRCUITPY -f',
      'rsync app.uf2 /media/CIRCUITPY --progress',
    ])
      expect(hardwareAction(command, dialect, { ...hardware, boardRoots: ['E:'] }), command).toBe(
        'program',
      )
    expect(hardwareAction('python -u espefuse.py burn-key KEY0 key.bin', dialect)).toBe('refused')
    expect(hardwareAction('env espefuse burn-key KEY0 key.bin', dialect)).toBe('refused')
  })
  it.each(dialects)('R2F8 help is offline and never labelled actuation (%s)', (dialect) => {
    for (const command of [
      'esptool --help',
      'espefuse --help',
      'picotool --help',
      'picotool help',
    ]) {
      expect(hardwareAction(command, dialect), command).toBeUndefined()
      expect(
        new PermissionEngine('allowAll').judge({ toolName: 'shell', toolClass: 'shell', command })
          .verdict,
      ).toBe('allow')
    }
  })
})

describe('300 developer command/dialect pairs inside and outside hardware', () => {
  it.each(dialects)(
    'zero new outside asks, exact hardware admission and unattended denial (%s)',
    (dialect) => {
      const expectedReads = new Set([
        'esptool --help',
        'espefuse --help',
        'picotool --help',
        'picotool help',
        ...(dialect === 'bash' ? ['cat README.md'] : []),
      ])
      expect(developerHardwareCorpus).toHaveLength(100)
      const context = { ...hardware, workspaceRoot: process.cwd() }
      const interactive = new PermissionEngine('onRequest')
      let reads = 0
      for (const command of developerHardwareCorpus) {
        const query = { toolName: 'shell', toolClass: 'shell', command, dialect } as const
        for (const mode of APPROVAL_MODES) {
          const outside = new PermissionEngine(mode)
          outside.allowForSession('shell', command)
          const judged = outside.judge(query)
          expect(judged.verdict, command).toBe(mode === 'denyUnmatched' ? 'deny' : 'allow')
          expect(
            outside.judge({
              ...query,
              hardware: { targets: [], boardRoots: [], isHardwareWorkspace: false },
            }),
          ).toEqual(judged)
          expect(
            outside.judge({ ...query, hardware: context, isUnattended: true }).verdict,
            command,
          ).toBe('deny')
        }
        const isReadOnly = expectedReads.has(command)
        expect(isReadOnlyHardwareCommand(command, dialect, context), command).toBe(isReadOnly)
        expect(interactive.judge({ ...query, hardware: context })).toMatchObject({
          verdict: isReadOnly ? 'allow' : 'ask',
          isReviewable: false,
          hasSessionChoice: false,
        })
        if (isReadOnly) reads += 1
      }
      expect(reads).toBe(dialect === 'bash' ? 5 : 4)
    },
  )
})
