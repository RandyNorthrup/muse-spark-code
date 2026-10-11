import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, inject, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BROWSER_ENGLISH, L10N_BUILDS_KEY, buildBrowserEnglish } from './helpers/l10nBuilds.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', isOwned: false, bundle: undefined, meta: undefined }
beforeAll(async () => {
  // Built once per run by globalSetup.mjs; a run without it builds its own.
  const shared = inject(L10N_BUILDS_KEY)
  if (shared === undefined) {
    built.folder = mkdtempSync(path.join(tmpdir(), 'muse-browser-english-'))
    built.isOwned = true
    await buildBrowserEnglish(built.folder)
  } else built.folder = path.join(shared, BROWSER_ENGLISH)
  built.meta = JSON.parse(readFileSync(path.join(built.folder, 'meta.json'), 'utf8'))
  built.bundle = await import(pathToFileURL(path.join(built.folder, 'probe.mjs')).href)
})
afterAll(() => (built.isOwned ? removeFolder(built.folder) : undefined))

const embedded = (table) => ({
  querySelector: () => ({ textContent: JSON.stringify({ locale: 'de', table }) }),
})
it('keeps account, developer and help values out of startup and loads them exactly on demand', async () => {
  expect(built.bundle.UI_TEXT.sendTitle).toBe(EN.sendTitle)
  expect(() => built.bundle.UI_TEXT.referenceIntro).toThrow('English surface is not loaded')
  expect(() => built.bundle.UI_TEXT.accounts).toThrow('English surface is not loaded')
  // STARTUP017: a restored settlement row's words paint with startup; the
  // rest of the schedule English loads only with the schedule surfaces.
  expect(built.bundle.UI_TEXT.scheduleSettlement).toEqual(EN.scheduleSettlement)
  expect(() => built.bundle.UI_TEXT.scheduleV2).toThrow('English surface is not loaded: scheduleV2')
  const chunk = Object.entries(built.meta.outputs).find(([, output]) =>
    Object.hasOwn(output.inputs, 'browser-surface-english:browser-surface-english'),
  )
  expect(chunk).toBeDefined()
  const scheduleChunk = Object.entries(built.meta.outputs).find(([, output]) =>
    Object.hasOwn(output.inputs, 'browser-schedule-english:browser-schedule-english'),
  )
  expect(scheduleChunk?.[0]).not.toBe(chunk[0])
  const main = Object.entries(built.meta.outputs).find(([file]) => file.endsWith('probe.mjs'))
  const seen = new Set()
  const reachesLoader = (file) => {
    if (seen.has(file)) return false
    seen.add(file)
    const output = built.meta.outputs[file]
    return (
      output?.imports.some(
        (edge) =>
          (edge.kind === 'dynamic-import' && edge.path === chunk[0]) ||
          (edge.kind === 'import-statement' && reachesLoader(edge.path)),
      ) ?? false
    )
  }
  expect(reachesLoader(main[0])).toBe(true)
  const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  expect(built.bundle.installEmbeddedTable(embedded(german))).toBeUndefined()
  await Promise.all([built.bundle.loadDeferredEnglish(), built.bundle.loadDeferredEnglish()])
  expect(built.bundle.UI_TEXT).toEqual(german)
  // The vault group's English loads with the vault surface alone (CAPS017).
  expect(() => built.bundle.EN.vault).toThrow('English surface is not loaded: vault')
  built.bundle.installVaultEnglish()
  // M107 U-C1: English read only by the resource chip and pages loads with
  // those surfaces (their modules import it), never with the other deferred groups.
  const resourceOnly = Object.keys(built.bundle.EN).filter((key) => {
    try {
      return built.bundle.EN[key] === undefined
    } catch (error) {
      return String(error).includes('English surface is not loaded')
    }
  })
  expect(resourceOnly.length).toBeGreaterThan(0)
  await built.bundle.loadResourceEnglish()
  for (const [key, value] of Object.entries(built.bundle.EN)) expect(value).toEqual(EN[key])
  built.bundle.setUiText(built.bundle.EN, 'en')
  for (const [key, value] of Object.entries(built.bundle.EN))
    expect(built.bundle.UI_TEXT[key]).toEqual(value)
})
it('validates deferred slots, keys and plurals before installing a translated table', async () => {
  await built.bundle.loadDeferredEnglish()
  built.bundle.installVaultEnglish()
  await built.bundle.loadResourceEnglish()
  const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  for (const mutate of [
    (table) => {
      table.accounts.keyPrompt = 'missing slots'
    },
    (table) => {
      delete table.accounts.title
    },
    (table) => {
      table.accounts.requestCount = 'not plural'
    },
    (table) => {
      table.developer.expires = '{wrong}'
    },
  ]) {
    const table = globalThis.structuredClone(german)
    mutate(table)
    expect(built.bundle.installEmbeddedTable(embedded(table))).toBeInstanceOf(Error)
    for (const [key, value] of Object.entries(built.bundle.EN))
      expect(built.bundle.UI_TEXT[key]).toEqual(value)
  }
})
