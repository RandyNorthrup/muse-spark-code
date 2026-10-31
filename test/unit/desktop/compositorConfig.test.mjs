import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expandBindings, generate, staleOutputs } from '../../../os/desktop/hyprland/generate.mjs'
import { desktopKeybindingSchema } from '../../../src/shared/desktop/compositor.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const hyprDir = path.join(repoRoot, 'os', 'desktop', 'hyprland')

async function readJson(file) {
  return JSON.parse(await readFile(path.join(repoRoot, file), 'utf8'))
}

function runScript(script, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(hyprDir, script), ...args], (error, stdout, stderr) => {
      resolve({ exit: error?.code ?? 0, stdout, stderr })
    })
  })
}

describe('key table expansion', () => {
  it('expands ranges and substitutes the desktop number', () => {
    const rows = expandBindings([
      {
        file: 'test.json',
        rows: [{ mods: ['SUPER'], key: '1..3', action: 'a', command: 'go("$n")' }],
      },
    ])
    expect(rows.map((row) => row.binding)).toEqual(['SUPER + 1', 'SUPER + 2', 'SUPER + 3'])
    expect(rows[1].command).toBe('go("2")')
  })

  it('canonicalizes modifier order for the duplicate check', () => {
    const rows = expandBindings([
      {
        file: 'test.json',
        rows: [{ mods: ['SHIFT', 'SUPER'], key: 'Q', action: 'a', command: 'x()' }],
      },
    ])
    expect(rows[0].binding).toBe('SUPER + SHIFT + Q')
  })

  it('refuses a duplicate binding, naming both rows', () => {
    expect(() =>
      expandBindings([
        {
          file: 'a.json',
          rows: [
            { mods: ['SUPER'], key: 'Q', action: 'first', command: 'x()' },
            { mods: ['SUPER'], key: 'q', action: 'second', command: 'y()' },
          ],
        },
      ]),
    ).toThrowError(/duplicate binding SUPER \+ q.*second.*first/s)
  })

  it('refuses duplicates across keybinding files', () => {
    expect(() =>
      expandBindings([
        {
          file: 'a.json',
          rows: [{ mods: ['SUPER'], key: '1..2', action: 'a', command: 'x($n)' }],
        },
        { file: 'b.json', rows: [{ mods: ['SUPER'], key: '2', action: 'b', command: 'y()' }] },
      ]),
    ).toThrowError(/duplicate binding SUPER \+ 2.*b\.json.*a\.json/s)
  })

  it('refuses an exit binding and malformed rows', () => {
    const exit = [{ mods: ['SUPER'], key: 'M', action: 'x', command: 'hl.dsp.exit()' }]
    expect(() => expandBindings([{ file: 'a.json', rows: exit }])).toThrowError(/exit binding/)
    const bare = [{ mods: ['SUPER'], key: 'M', action: 'x', command: 'bye( exit ()' }]
    expect(() => expandBindings([{ file: 'a.json', rows: bare }])).toThrowError(/exit binding/)
    const unsubstituted = [{ mods: ['SUPER'], key: 'Q', action: 'x', command: 'go("$n")' }]
    expect(() => expandBindings([{ file: 'a.json', rows: unsubstituted }])).toThrowError(
      /without a key range/,
    )
    const backwards = [{ mods: ['SUPER'], key: '9..1', action: 'x', command: 'go("$n")' }]
    expect(() => expandBindings([{ file: 'a.json', rows: backwards }])).toThrowError(/backwards/)
    const modded = [{ mods: ['HYPER'], key: 'Q', action: 'x', command: 'go()' }]
    expect(() => expandBindings([{ file: 'a.json', rows: modded }])).toThrowError(/modifier HYPER/)
  })
})

describe('generated configs', () => {
  it('keeps every committed output byte-fresh', async () => {
    const outputs = await generate()
    expect(outputs.size).toBe(3)
    for (const [file, content] of outputs) {
      expect(await readFile(path.join(repoRoot, file), 'utf8')).toBe(content)
    }
  })

  it('derives values from the theme twin, never by hand', async () => {
    const theme = await readJson('desktop/shell/theme/hyprland-theme.json')
    const dark = theme.modes.dark
    const full = await readFile(path.join(hyprDir, 'hyprland.lua'), 'utf8')
    expect(full).toContain(`gaps_in = ${dark.innerGap}`)
    expect(full).toContain(`gaps_out = ${dark.outerGap}`)
    expect(full).toContain(`rounding = ${dark.rounding}`)
    expect(full).toContain(`border_size = ${dark.borderWidth}`)
    expect(full).toContain(`active_border = "rgb(${dark.focusedBorder.hex.slice(1)})"`)
    expect(full).toContain(`inactive_border = "rgb(${dark.unfocusedBorder.hex.slice(1)})"`)
    expect(full).toContain(`speed = ${dark.durationFastMs / 100}`)
    expect(full).toContain(`speed = ${dark.durationBaseMs / 100}`)
    expect(full).toContain(`speed = ${dark.durationSlowMs / 100}`)
    const [x0, y0, x1, y1] = dark.bezierStandard
    expect(full).toContain(`{ { ${x0}, ${y0} }, { ${x1}, ${y1} } }`)
  })

  it('gives the light profile no blur or shadows and shorter animations', async () => {
    const theme = await readJson('desktop/shell/theme/hyprland-theme.json')
    const dark = theme.modes.dark
    const light = await readFile(path.join(hyprDir, 'hyprland-light.lua'), 'utf8')
    expect(light).toContain('blur = { enabled = false }')
    expect(light).toContain('shadow = { enabled = false')
    expect(light).toContain('direct_scanout = 1')
    expect(light).toContain(`speed = ${dark.durationBaseMs / 200}`)
    expect(light).not.toContain(`size = ${dark.blur}`)
  })

  it('binds every key table row exactly once', async () => {
    const keys = JSON.parse(await readFile(path.join(hyprDir, 'keys.json'), 'utf8'))
    for (const row of keys) {
      expect(desktopKeybindingSchema.safeParse(row).success).toBe(true)
    }
    const full = await readFile(path.join(hyprDir, 'hyprland.lua'), 'utf8')
    const binds = full.split('\n').filter((line) => line.startsWith('hl.bind('))
    expect(binds).toHaveLength(keys.length)
    for (const row of keys) {
      const line = `hl.bind(${JSON.stringify(row.binding)}, ${row.command})`
      expect(binds.filter((bind) => bind === line)).toHaveLength(1)
    }
    const light = await readFile(path.join(hyprDir, 'hyprland-light.lua'), 'utf8')
    const lightBinds = light.split('\n').filter((line) => line.startsWith('hl.bind('))
    expect(lightBinds).toEqual(binds)
  })

  it('renders the key helpers and the pin into the configs', async () => {
    const full = await readFile(path.join(hyprDir, 'hyprland.lua'), 'utf8')
    expect(full).toContain('local function muse_merge_desktop(n)')
    expect(full).toContain('local function muse_send_new()')
    const pin = await readJson('os/desktop/hyprland/pin.json')
    expect(full).toContain(`Hyprland pin: ${pin.version} (${pin.suite})`)
  })
})

describe('staleness', () => {
  it('names every drifted output and nothing else', () => {
    const outputs = new Map([
      ['a', 'same'],
      ['b', 'want'],
    ])
    expect(staleOutputs(outputs, (file) => (file === 'a' ? 'same' : 'have'))).toEqual(['b'])
    expect(staleOutputs(outputs, (file) => outputs.get(file))).toEqual([])
    expect(staleOutputs(outputs, () => null)).toEqual(['a', 'b'])
  })

  it('passes --check on the real tree', async () => {
    const { exit, stdout } = await runScript('generate.mjs', ['--check'])
    expect(exit).toBe(0)
    expect(stdout).toContain('0 problems')
  })
})

describe('verify-config gate', () => {
  it('refuses honestly when Hyprland is not installed', async () => {
    const { exit, stderr } = await runScript('verify-config.mjs', [
      '--binary',
      'hyprland-binary-that-does-not-exist',
    ])
    expect(exit).toBe(1)
    expect(stderr).toContain('on PATH')
  })
})
