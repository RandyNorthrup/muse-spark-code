// M67/M78 joined file admission over real native filesystem paths and reads.
// The language providers are offline fixtures; their documents stay on disk.
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRename } from '../../src/core/backends/modelapi/codeIntelCalls'
import { compilePolicy } from '../../src/core/backends/modelapi/permissionPolicy'
import { CodeIntelRefusal, type CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { answerCodeIntel } from '../../src/core/codeIntel/codeIntelTools'
import { planRename } from '../../src/core/codeIntel/rename'
import { repoMapSection } from '../../src/core/codeIntel/repoMap'
import type { PermissionSettings } from '../../src/core/permissionSettings'
import { createToolIo } from '../../src/host/backend/toolIo'
import { CODE_INTEL_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import {
  fakeLanguageService,
  KIND,
  loc,
  sym,
  type FakeServiceOptions,
} from './helpers/fakeLanguageService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function settings(denyRead: readonly string[]): PermissionSettings {
  return {
    commandRules: [],
    profiles: { restricted: { denyRead } },
    profile: 'restricted',
    repositoryRules: undefined,
  }
}

async function setup(serviceOptions: Omit<FakeServiceOptions, 'files'> = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-code-policy-')))
  roots.push(root)
  await mkdir(path.join(root, 'public'))
  await mkdir(path.join(root, 'private'))
  const main = path.join(root, 'public', 'main.ts')
  const helper = path.join(root, 'public', 'helper.ts')
  const secret = path.join(root, 'private', 'secret.ts')
  const files = new Map([
    [main, 'helper(); privateOnly();\n'],
    [helper, 'export function helper() {}\n'],
    [secret, 'export function privateOnly() {}\n'],
  ])
  for (const [file, text] of files) await writeFile(file, text)
  const io = createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => process.env,
    listFiles: () => Promise.resolve(['public/main.ts', 'public/helper.ts', 'private/secret.ts']),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
  const service = fakeLanguageService({ files, ...serviceOptions })
  let current = compilePolicy(settings(['private/**']), process.platform)
  const deps: CodeIntelDeps = {
    service,
    io,
    workspaceRoot: root,
    platform: process.platform,
    now: () => 0,
    canReadFile: (file) => !current.files.isDenied([file.relative, file.canonical]),
  }
  return {
    root,
    main,
    helper,
    secret,
    files,
    service,
    io,
    deps,
    setRules: (denyRead: readonly string[]) => {
      current = compilePolicy(settings(denyRead), process.platform)
    },
    assertAccess: (file: { readonly relative: string; readonly canonical: string }) => {
      if (current.files.isDenied([file.relative, file.canonical])) {
        throw new CodeIntelRefusal(
          CODE_INTEL_MODEL_TEXT.codeIntelPolicyRefused,
          UI_TEXT.codeIntelPolicyRefused,
        )
      }
    },
  }
}

async function answered(work: Promise<Awaited<ReturnType<typeof answerCodeIntel>>>) {
  const answer = await work
  if (!answer.ok) throw new Error(answer.reason)
  return answer.text
}

async function renamePlan(t: Awaited<ReturnType<typeof setup>>) {
  t.service.rename = () =>
    Promise.resolve({
      fileOperations: 'none',
      files: [
        { path: t.helper, edits: [{ range: loc(t.helper, 0, 16, 6).range, newText: 'renamed' }] },
        { path: t.main, edits: [{ range: loc(t.main, 0, 0, 6).range, newText: 'renamed' }] },
      ],
    })
  const result = await planRename(
    { path: 'public/helper.ts', line: 1, column: 17, new_name: 'renamed' },
    t.deps,
  )
  if (!result.ok) throw new Error(result.reason)
  return result.plan
}

async function referenceText(t: Awaited<ReturnType<typeof setup>>): Promise<string> {
  return await answered(
    answerCodeIntel('findReferences', { path: 'public/main.ts', line: 1, column: 1 }, t.deps),
  )
}

describe('code intelligence file policy over native IO (M67/M78)', () => {
  it('keeps allowed references while withholding denied paths and their disk contents', async () => {
    const t = await setup()
    t.service.references = () => Promise.resolve([loc(t.helper, 0, 16), loc(t.secret, 0, 16)])
    const reads = vi.spyOn(t.io, 'readFile')
    const text = await referenceText(t)
    expect(text).toContain('public/helper.ts')
    expect(text).toContain('withheld by file permission rules')
    expect(text).not.toContain('private/secret.ts')
    expect(text).not.toContain('privateOnly')
    expect(reads.mock.calls.some(([file]) => file === t.secret)).toBe(false)
  })

  it('refuses a denied primary document before the provider opens it, then supports it when allowed', async () => {
    const t = await setup()
    t.service.documentSymbols = () =>
      Promise.resolve([sym('privateOnly', KIND.function, t.secret, 0, 16)])
    await expect(
      answerCodeIntel('documentSymbols', { path: 'private/secret.ts' }, t.deps),
    ).resolves.toMatchObject({
      ok: false,
      visibleReason: UI_TEXT.codeIntelPolicyRefused,
    })
    expect(t.service.asked).toEqual([])
    t.setRules([])
    expect(
      await answered(answerCodeIntel('documentSymbols', { path: 'private/secret.ts' }, t.deps)),
    ).toContain('privateOnly')
  })

  it('uses a real junction or symlink canonical path to deny an otherwise allowed alias', async () => {
    const t = await setup()
    const alias = path.join(t.root, 'public', 'alias')
    await symlink(
      path.join(t.root, 'private'),
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const linked = path.join(alias, 'secret.ts')
    t.service.references = () => Promise.resolve([loc(t.helper, 0, 16), loc(linked, 0, 16)])
    const reads = vi.spyOn(t.io, 'readFile')
    const text = await referenceText(t)
    expect(text).toContain('public/helper.ts')
    expect(text).not.toContain('alias')
    expect(text).not.toContain('privateOnly')
    expect(reads.mock.calls.some(([file]) => file === t.secret || file === linked)).toBe(false)
  })

  it('refuses unattributable hover text from a denied declaration and filters denied document symbols', async () => {
    const t = await setup()
    t.service.hover = () => Promise.resolve(['privateOnly documentation'])
    t.service.definitions = () => Promise.resolve([loc(t.secret, 0, 16)])
    const hover = await answerCodeIntel(
      'hover',
      { path: 'public/main.ts', line: 1, column: 1 },
      t.deps,
    )
    expect(hover).toMatchObject({ ok: false, visibleReason: UI_TEXT.codeIntelPolicyRefused })
    expect(JSON.stringify(hover)).not.toContain('privateOnly documentation')
    t.service.documentSymbols = () =>
      Promise.resolve([
        sym('helper', KIND.function, t.main, 0, 0),
        sym('privateOnly', KIND.function, t.secret, 0, 16),
      ])
    const outline = await answered(
      answerCodeIntel('documentSymbols', { path: 'public/main.ts' }, t.deps),
    )
    expect(outline).toContain('helper')
    expect(outline).not.toContain('privateOnly')
  })

  it('never reads denied repo-map inputs or publishes their symbol names in tool or prompt maps', async () => {
    const t = await setup()
    t.service.workspaceSymbols = (name) =>
      Promise.resolve(
        [
          sym('helper', KIND.function, t.helper, 0, 16),
          sym('privateOnly', KIND.function, t.secret, 0, 16),
        ].filter((symbol) => symbol.name === name),
      )
    const reads = vi.spyOn(t.io, 'readFile')
    const tool = await answered(answerCodeIntel('repoMap', {}, t.deps))
    const prompt = await repoMapSection(t.deps, new AbortController().signal)
    for (const text of [tool, prompt]) {
      expect(text).toContain('public/helper.ts')
      expect(text).not.toContain('private/secret.ts')
      expect(text).not.toContain('privateOnly')
    }
    expect(reads.mock.calls.some(([file]) => file === t.secret)).toBe(false)
  })

  it('refuses returned information after policy changes during the provider await', async () => {
    const t = await setup()
    const held = Promise.withResolvers<readonly ReturnType<typeof loc>[]>()
    const started = Promise.withResolvers<undefined>()
    t.service.references = () => {
      started.resolve(undefined)
      return held.promise
    }
    const answering = answerCodeIntel(
      'findReferences',
      { path: 'public/main.ts', line: 1, column: 1 },
      t.deps,
    )
    await started.promise
    t.setRules(['public/**', 'private/**'])
    held.resolve([loc(t.helper, 0, 16)])
    expect(await answering).toMatchObject({
      ok: false,
      visibleReason: UI_TEXT.codeIntelPolicyRefused,
    })
  })

  it('rechecks policy after rename confinement waits, before reading or writing a now-denied file', async () => {
    const t = await setup()
    const plan = await renamePlan(t)
    const first = plan.files[0]
    if (first === undefined) throw new Error('Expected two-file rename')
    const held = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    const realPath = t.io.realPath.bind(t.io)
    let hasHeld = false
    t.io.realPath = async (file) => {
      const resolved = await realPath(file)
      if (!hasHeld && file === first.absolute) {
        hasHeld = true
        started.resolve(undefined)
        await held.promise
      }
      return resolved
    }
    const reads = vi.spyOn(t.io, 'readFile')
    const writes = vi.spyOn(t.io, 'writeFile')
    const applying = applyRename(plan, {
      workspaceRoot: t.root,
      platform: process.platform,
      io: t.io,
      seen: new Map(),
      signal: new AbortController().signal,
      beforeAccess: t.assertAccess,
    })
    await started.promise
    t.setRules(['public/**'])
    held.resolve(undefined)
    expect(await applying).toMatchObject({ failureReason: UI_TEXT.codeIntelPolicyRefused })
    expect(reads).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
    for (const [file, before] of t.files) expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('reports the applied patch honestly when a new policy blocks the second rename file', async () => {
    const t = await setup()
    const plan = await renamePlan(t)
    const first = plan.files[0]
    const second = plan.files[1]
    if (first === undefined || second === undefined) throw new Error('Expected two-file rename')
    const write = t.io.writeFile.bind(t.io)
    t.io.writeFile = async (...args) => {
      await write(...args)
      t.setRules([second.relative])
    }
    const result = await applyRename(plan, {
      workspaceRoot: t.root,
      platform: process.platform,
      io: t.io,
      seen: new Map(),
      signal: new AbortController().signal,
      beforeAccess: t.assertAccess,
    })
    expect(result.failureReason).toContain(CODE_INTEL_MODEL_TEXT.codeIntelPolicyRefused)
    expect(result.patch?.summary.files).toBe(1)
    expect(await readFile(first.checkedAbsolute, 'utf8')).toBe(first.after)
    expect(await readFile(second.checkedAbsolute, 'utf8')).toBe(second.before)
  })
})
