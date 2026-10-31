// Muse Desktop (M111, D91.20) lane IN: check:l10n answers for native
// sources. Every ui_text! literal and every UiText.text literal must name a
// UI string (a wrong key fails the gate with its file and line, never ships
// as an echo); the generated tables must match the fifteen tables; and the
// load-order scan covers desktop TypeScript, so the workbench's main
// process answers it when lane WB merges.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  checkDesktopGenerated,
  checkDesktopKeys,
  checkLoadOrder,
  nativeKeys,
  qmlKeyUses,
  rustKeyUses,
} from '../../../scripts/lib/localizationGate.mjs'
import { loadL10n } from '../../../scripts/lib/l10nSource.mjs'
import { loadTables, renderAll } from '../../../desktop/crates/l10n/tools/tables.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const shared = {}
beforeAll(async () => {
  shared.l10n = await loadL10n(root)
  shared.loaded = await loadTables(root)
})

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempRoot() {
  mkdirSync(path.join(root, 'temp'), { recursive: true })
  const dir = mkdtempSync(path.join(root, 'temp', 'in-gate-'))
  scratch.push(dir)
  return dir
}
function write(dir, file, text) {
  const absolute = path.join(dir, file)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, text)
}

describe('M111 lane IN localization gate', () => {
  it('reads native keys as plain strings and plural forms, never whole objects', () => {
    const valid = nativeKeys(shared.l10n.EN, shared.l10n.isPluralForms)
    expect(valid.has('desktop.orSignInWith')).toBe(true)
    expect(valid.has('desktop.notificationsCount.one')).toBe(true)
    expect(valid.has('desktop.notificationsCount')).toBe(false)
  })

  it('finds macro calls through spacing and reports their lines', () => {
    expect(rustKeyUses('macro_rules! ui_text { ($key:literal) => {} }\n')).toEqual([])
    expect(
      rustKeyUses('let a = ui_text!("desktop.cancel");\nlet b = ui_text!(\n"desktop.back");'),
    ).toEqual([
      { key: 'desktop.cancel', line: 1 },
      { key: 'desktop.back', line: 2 },
    ])
    expect(qmlKeyUses('function text(key) { return key }\n')).toEqual([])
    expect(
      qmlKeyUses('t(UiText.text("desktop.cancel"))\nt(UiText.text(\'desktop.back\'))'),
    ).toEqual([
      { key: 'desktop.cancel', line: 1 },
      { key: 'desktop.back', line: 2 },
    ])
  })

  it('fails unknown native keys with file and line', () => {
    const dir = tempRoot()
    write(
      dir,
      'desktop/shell/bar.rs',
      'let a = ui_text!("desktop.orSignInWith");\nlet b = ui_text!("desktop.noSuchKey");\n',
    )
    write(
      dir,
      'test/desktop/check.qml',
      'UiText.text("desktop.cancel")\nUiText.text("desktop.noSuchKey")\n',
    )
    const problems = []
    const counts = checkDesktopKeys(shared.l10n.EN, shared.l10n.isPluralForms, problems, dir)
    expect(counts).toEqual({ rust: 1, qml: 1 })
    expect(problems).toEqual([
      'desktop/shell/bar.rs:2: ui_text!("desktop.noSuchKey") is not a UI string',
      'test/desktop/check.qml:2: UiText.text("desktop.noSuchKey") is not a UI string',
    ])
  })

  it('skips native checks without a desktop tree', () => {
    const problems = []
    expect(
      checkDesktopKeys(shared.l10n.EN, shared.l10n.isPluralForms, problems, tempRoot()),
    ).toEqual({
      rust: 0,
      qml: 0,
    })
    expect(problems).toEqual([])
    checkDesktopGenerated(shared.l10n, new Map(), problems, tempRoot())
    expect(problems).toEqual([])
  })

  it('fails stale generated tables and passes fresh ones', () => {
    const uiTables = new Map(
      shared.loaded.locales
        .filter((locale) => locale !== 'en')
        .map((locale) => [locale, shared.loaded.nested[locale]]),
    )
    const dir = tempRoot()
    mkdirSync(path.join(dir, 'desktop'), { recursive: true })
    const problems = []
    checkDesktopGenerated(shared.l10n, uiTables, problems, dir)
    expect(problems).toHaveLength(2)
    for (const { file, text } of renderAll(shared.loaded)) write(dir, file, text)
    const fresh = []
    checkDesktopGenerated(shared.l10n, uiTables, fresh, dir)
    expect(fresh).toEqual([])
  })

  it('holds desktop TypeScript to the load-order rule', () => {
    const dir = tempRoot()
    write(
      dir,
      'desktop/app/main.ts',
      "import { UI_TEXT } from '../../../src/shared/l10n/en'\nconst title = UI_TEXT.desktop.cancel\n",
    )
    write(
      dir,
      'desktop/app/clean.ts',
      "import { UI_TEXT } from '../../../src/shared/l10n/en'\nexport function title() {\n  return UI_TEXT.desktop.cancel\n}\n",
    )
    const problems = []
    expect(checkLoadOrder(problems, dir)).toBe(2)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('desktop/app/main.ts:2:')
    expect(problems[0]).toContain('read at module load')
  })
})
