// Muse Desktop (M111, D91.3) lane CP: the Hyprland config generator. Reads
// the desktop theme twin (TH's output), the pinned version, and every
// keybinding source; writes the full and light Lua configs plus the
// expanded key table. Fails on any duplicate binding and on any exit
// binding (D91.7: nothing calls Hyprland's exit). Other lanes add binds by
// dropping in keybindings.<lane>.json; the duplicate check spans all of
// them. Usage: node os/desktop/hyprland/generate.mjs [--check]

import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
import * as z from 'zod'

const HERE = import.meta.dirname
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

const THEME_FILE = 'desktop/shell/theme/hyprland-theme.json'
const FULL_CONFIG = 'os/desktop/hyprland/hyprland.lua'
const LIGHT_CONFIG = 'os/desktop/hyprland/hyprland-light.lua'
const KEYS_FILE = 'os/desktop/hyprland/keys.json'

// Modifiers, canonical first: SUPER, CTRL, ALT, SHIFT.
const MOD_ORDER = ['SUPER', 'CTRL', 'ALT', 'SHIFT']
const KNOWN_MODS = new Set(MOD_ORDER)

// Any exit dispatch, however qualified: never bound (D91.7).
const EXIT_CALL = /\bexit\s*\(/
const RANGE_KEY = /^(\d+)\.\.(\d+)$/

const themeColourSchema = z.object({ hex: z.string(), argb: z.number() })
const themeModeSchema = z.object({
  unfocusedBorder: themeColourSchema,
  focusedBorder: themeColourSchema,
  shadow: themeColourSchema,
  innerGap: z.number(),
  outerGap: z.number(),
  rounding: z.number(),
  borderWidth: z.number(),
  bezierStandard: z.array(z.number()).length(4),
  bezierEmphasised: z.array(z.number()).length(4),
  durationFastMs: z.number(),
  durationBaseMs: z.number(),
  durationSlowMs: z.number(),
  blur: z.number(),
})
const themeSchema = z.object({
  version: z.number(),
  modes: z.object({
    light: themeModeSchema,
    dark: themeModeSchema,
    'hc-light': themeModeSchema,
    'hc-dark': themeModeSchema,
  }),
})

const keybindingRowSchema = z.object({
  mods: z.array(z.string()).min(1),
  key: z.string().min(1),
  action: z.string().min(1),
  command: z.string().min(1),
})
const keybindingsSchema = z.object({ version: z.literal(1), rows: z.array(keybindingRowSchema) })

const pinSchema = z.object({
  package: z.literal('hyprland'),
  version: z.string().min(1),
  suite: z.string().min(1),
})

function fail(message) {
  throw new Error(`hyprland config: ${message}`)
}

function canonicalMods(mods, where) {
  const upper = mods.map((mod) => mod.toUpperCase())
  for (const mod of upper) {
    if (!KNOWN_MODS.has(mod)) fail(`${where}: unknown modifier ${mod}`)
  }
  return upper.toSorted((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
}

function expandRange(key, where) {
  const range = RANGE_KEY.exec(key)
  if (!range) return [key]
  const from = Number(range[1])
  const to = Number(range[2])
  if (from > to) fail(`${where}: range ${key} runs backwards`)
  const keys = []
  for (let n = from; n <= to; n += 1) keys.push(String(n))
  return keys
}

// Every binding in effect, canonicalized, across every keybinding source.
// Throws on the first duplicate or exit binding, naming both rows.
export function expandBindings(sources) {
  const bindings = []
  const seen = new Map()
  for (const { file, rows } of sources) {
    for (const [index, row] of rows.entries()) {
      const where = `${file} row ${index} (${row.action})`
      const mods = canonicalMods(row.mods, where)
      const isRange = RANGE_KEY.test(row.key)
      if (!isRange && row.command.includes('$n')) fail(`${where}: $n without a key range`)
      if (EXIT_CALL.test(row.command)) fail(`${where}: an exit binding is never generated`)
      for (const key of expandRange(row.key, where)) {
        const command = isRange ? row.command.replaceAll('$n', () => key) : row.command
        if (command.includes('$n')) fail(`${where}: unsubstituted $n`)
        const binding = [...mods, key].join(' + ')
        const clash = seen.get(`${mods.join('+')}\0${key.toUpperCase()}`)
        if (clash) fail(`duplicate binding ${binding}: ${where} clashes with ${clash}`)
        seen.set(`${mods.join('+')}\0${key.toUpperCase()}`, where)
        bindings.push({ binding, action: row.action, command })
      }
    }
  }
  return bindings.toSorted((a, b) => a.binding.localeCompare(b.binding, 'en'))
}

function hyprColour(hex, where) {
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex)
  if (!match) fail(`${where}: colour ${hex} is not #rrggbb[aa]`)
  return match[1].length === 6 ? `rgb(${match[1]})` : `rgba(${match[1]})`
}

function decisecs(ms) {
  return Number((ms / 100).toFixed(2))
}

function renderValues(mode, light) {
  const speeds = light
    ? {
        fast: decisecs(mode.durationFastMs / 2),
        base: decisecs(mode.durationBaseMs / 2),
        slow: decisecs(mode.durationSlowMs / 2),
      }
    : {
        fast: decisecs(mode.durationFastMs),
        base: decisecs(mode.durationBaseMs),
        slow: decisecs(mode.durationSlowMs),
      }
  const [sx0, sy0, sx1, sy1] = mode.bezierStandard
  const [ex0, ey0, ex1, ey1] = mode.bezierEmphasised
  const blur = light ? 'enabled = false' : `enabled = true, size = ${mode.blur}`
  const shadow = light ? 'enabled = false' : 'enabled = true'
  const scanout = light ? '\n  render = { direct_scanout = 1 },' : ''
  return { speeds, beziers: { sx0, sy0, sx1, sy1, ex0, ey0, ex1, ey1 }, blur, shadow, scanout }
}

const HELPERS = `-- The focused monitor's workspace: a merge lands here.
local function muse_active_workspace()
  for _, m in ipairs(hl.get_monitors()) do
    if m.focused and m.active_workspace ~= nil then return m.active_workspace end
  end
  return nil
end

-- A merge moves every client from one desktop to another (D91.15).
-- Desktops answer to what they were created as, labels aside.
local function muse_merge_desktop(n)
  local target = muse_active_workspace()
  if target == nil then return end
  local source = hl.get_workspace(tostring(n))
  if source == nil or source.id == target.id then return end
  for _, w in ipairs(hl.get_workspace_windows(tostring(n))) do
    hl.dispatch(hl.dsp.window.move({ window = w, workspace = tostring(target.id), follow = false }))
  end
end

-- A new desktop past the highest id, with focus following the window.
local function muse_send_new()
  local maxId = 0
  for _, ws in ipairs(hl.get_workspaces()) do
    if ws.id ~= nil and ws.id > maxId then maxId = ws.id end
  end
  hl.dispatch(hl.dsp.window.move({ workspace = tostring(maxId + 1), follow = true }))
end
`

export function renderLua(theme, pin, bindings, light) {
  const mode = theme.modes.dark
  const activeBorder = hyprColour(mode.focusedBorder.hex, 'focusedBorder')
  const inactiveBorder = hyprColour(mode.unfocusedBorder.hex, 'unfocusedBorder')
  const shadowColour = hyprColour(mode.shadow.hex, 'shadow')
  const values = renderValues(mode, light)
  const { speeds, beziers } = values
  const header = light ? 'light profile: no blur or shadows, shorter animations' : 'full profile'
  const binds = bindings.map((row) => `hl.bind(${JSON.stringify(row.binding)}, ${row.command})`)
  return `-- Generated by os/desktop/hyprland/generate.mjs from the desktop theme
-- (v${theme.version}) and the keybinding sources. Do not edit: --check fails
-- on drift, and Hyprland's --verify-config gates the result. ${header}.
-- Hyprland pin: ${pin.version} (${pin.suite}).
-- The generated config carries dark's values; the port applies the live
-- appearance (light, high contrast, reduced motion) through hl.config.
hl.config({
  animations = { enabled = true },
  decoration = {
    rounding = ${mode.rounding},
    blur = { ${values.blur} },
    shadow = { ${values.shadow}, color = ${JSON.stringify(shadowColour)} },
  },
  ecosystem = { enforce_permissions = true, no_update_news = true, no_donation_nag = true },
  general = {
    layout = "dwindle",
    gaps_in = ${mode.innerGap},
    gaps_out = ${mode.outerGap},
    border_size = ${mode.borderWidth},
    col = {
      active_border = ${JSON.stringify(activeBorder)},
      inactive_border = ${JSON.stringify(inactiveBorder)},
    },
  },
  misc = {
    disable_hyprland_logo = true,
    disable_splash_rendering = true,
    enable_anr_dialog = false,
  },
  xwayland = { enabled = false },${values.scanout}
})

-- Curves and timings from the motion tokens (deciseconds).
hl.curve("muse_standard", {
  type = "bezier",
  points = { { ${beziers.sx0}, ${beziers.sy0} }, { ${beziers.sx1}, ${beziers.sy1} } },
})
hl.curve("muse_emphasised", {
  type = "bezier",
  points = { { ${beziers.ex0}, ${beziers.ey0} }, { ${beziers.ex1}, ${beziers.ey1} } },
})
hl.animation({ leaf = "windows", enabled = true, speed = ${speeds.base}, bezier = "muse_standard", style = "slide" })
hl.animation({ leaf = "workspaces", enabled = true, speed = ${speeds.slow}, bezier = "muse_emphasised", style = "slide" })
hl.animation({ leaf = "fade", enabled = true, speed = ${speeds.fast}, bezier = "muse_standard" })
hl.animation({ leaf = "layers", enabled = true, speed = ${speeds.base}, bezier = "muse_standard", style = "slide" })
hl.animation({ leaf = "border", enabled = true, speed = ${speeds.fast}, bezier = "muse_standard" })

-- Monitors stay automatic here; the settings app arranges them live
-- through the port and persists them.
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })

-- Three-finger horizontal swipes move between desktops.
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })

-- Floating exceptions (D91.15): modal dialogs, picture-in-picture. The
-- launcher and every shell surface are layer-shell and never tile, so they
-- need no rule; the workbench floats a detached terminal through the port
-- when it detaches (D91.13), which no static rule can match.
hl.window_rule({ match = { modal = true }, float = true })
hl.window_rule({ match = { title = "^Picture-in-Picture$" }, float = true })
hl.window_rule({ match = { title = "^Picture in picture$" }, float = true })

-- Screencopy belongs to the shell and the portals only; plugins load from
-- our read-only path, never through hyprctl; a new keyboard asks in the
-- shell before it types (D55, D62). The internal AT keyboard is allowed.
hl.permission({ binary = "/usr/bin/muse-shell", type = "screencopy", mode = "allow" })
hl.permission({
  binary = "/usr/(lib|libexec|lib64)/xdg-desktop-portal-hyprland",
  type = "screencopy",
  mode = "allow",
})
hl.permission({
  binary = "/usr/(lib|libexec|lib64)/xdg-desktop-portal-muse",
  type = "screencopy",
  mode = "allow",
})
hl.permission({ binary = "/usr/lib/muse-hyprland/.*", type = "plugin", mode = "allow" })
hl.permission({ binary = ".*/hyprctl", type = "plugin", mode = "deny" })
hl.permission({ binary = "AT Translated Set 2 keyboard", type = "keyboard", mode = "allow" })
hl.permission({ binary = ".*", type = "keyboard", mode = "ask" })

${HELPERS}
${binds.join('\n')}
`
}

export function renderKeys(bindings) {
  return `${JSON.stringify(
    bindings.map((row) => ({ ...row, applies: 'desktop' })),
    null,
    2,
  )}\n`
}

async function keybindingSources() {
  const dir = path.join(REPO_ROOT, 'os', 'desktop', 'hyprland')
  const entries = await readdir(dir)
  const files = entries
    .filter((file) => file === 'keybindings.json' || file.startsWith('keybindings.'))
    .filter((file) => file.endsWith('.json') && file !== 'keys.json')
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  const sources = []
  for (const file of files) {
    const parsed = keybindingsSchema.parse(JSON.parse(await readFile(path.join(dir, file), 'utf8')))
    sources.push({ file: `os/desktop/hyprland/${file}`, rows: parsed.rows })
  }
  return sources
}

export async function generate() {
  const theme = themeSchema.parse(
    JSON.parse(await readFile(path.join(REPO_ROOT, THEME_FILE), 'utf8')),
  )
  const pin = pinSchema.parse(
    JSON.parse(
      await readFile(path.join(REPO_ROOT, 'os', 'desktop', 'hyprland', 'pin.json'), 'utf8'),
    ),
  )
  const bindings = expandBindings(await keybindingSources())
  const keys = await prettier.format(renderKeys(bindings), {
    ...(await prettier.resolveConfig(path.join(REPO_ROOT, KEYS_FILE))),
    filepath: KEYS_FILE,
  })
  return new Map([
    [FULL_CONFIG, renderLua(theme, pin, bindings, false)],
    [LIGHT_CONFIG, renderLua(theme, pin, bindings, true)],
    [KEYS_FILE, keys],
  ])
}

export function staleOutputs(outputs, read) {
  const stale = []
  for (const [file, content] of outputs) {
    if (read(file) !== content) stale.push(file)
  }
  return stale
}

async function main() {
  const check = process.argv.includes('--check')
  const outputs = await generate()
  if (check) {
    const current = new Map()
    for (const [file] of outputs) {
      let content
      try {
        content = await readFile(path.join(REPO_ROOT, file), 'utf8')
      } catch {
        content = null
      }
      current.set(file, content)
    }
    const stale = staleOutputs(outputs, (file) => current.get(file))
    if (stale.length > 0) {
      console.error(`hyprland config: stale output (regenerate): ${stale.join(', ')}`)
      process.exitCode = 1
    } else {
      console.log('hyprland config: 0 problems')
    }
  } else {
    for (const [file, content] of outputs) {
      await writeFile(path.join(REPO_ROOT, file), content)
    }
    console.log(`hyprland config: generated ${outputs.size} outputs`)
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main()
}
