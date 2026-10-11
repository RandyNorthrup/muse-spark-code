import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { HOST_PLUGINS } from '../../scripts/lib/hostPlugins.mjs'
import {
  deferredCohort,
  sharedUiText,
  sharedValidation,
} from '../../scripts/lib/deferredBundles.mjs'
import { EN } from '../../src/shared/l10n/en'
import { nativeCreated, nativeScratch, useCreatedNative } from './helpers/createdNative'

useCreatedNative()
const require = createRequire(import.meta.url)
const state = { folder: '' }
const workerNativeOperation = async (proof, op, identity = '') =>
  JSON.parse(
    await nativeCreated([
      op,
      proof.root,
      proof.rootIdentity,
      proof.ancestor,
      proof.ancestorIdentity,
      proof.remaining,
      identity,
    ]),
  )
beforeAll(async () => {
  state.folder = path.join(nativeScratch(), 'package')
  const options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    minify: true,
    logLevel: 'silent',
    outdir: path.join(state.folder, 'dist'),
  }
  await build({
    ...options,
    plugins: [...HOST_PLUGINS],
    entryPoints: {
      teamHost: 'src/core/team/workers/workerFence.ts',
      teamFileIo: 'src/core/team/workers/workerToolIoEntry.ts',
      teamCreate: 'src/core/team/workers/workerCreateEntry.ts',
    },
  })
  await build({
    ...options,
    plugins: [sharedUiText, sharedValidation, deferredCohort],
    entryPoints: {
      resourceAdmission: 'src/core/resources/admissionEntry.ts',
      resourceGovernor: 'src/core/resources/resourceGovernorEntry.ts',
      modelApiBoundaries: 'src/core/nodeBoundariesEntry.ts',
      vaultBoundaries: 'src/shared/vaultBoundariesEntry.ts',
    },
  })
  await build({
    ...options,
    entryPoints: {
      validation: 'src/shared/validationEntry.ts',
      uiText: 'src/shared/l10n/en.ts',
    },
  })
  if (process.platform !== 'linux') return
  const directory = path.join(state.folder, 'native', 'linux', process.arch)
  await mkdir(directory, { recursive: true })
  await copyFile(path.join(nativeScratch(), 'created'), path.join(directory, 'muse-created'))
}, 30_000) // Compile the real native/helper bundle graph once; test deadlines remain the repository default.

it('NF packaged file adapter shares the retained grant and loads native creation only on first use', async () => {
  const dist = path.join(state.folder, 'dist')
  const host = require(path.join(dist, 'teamHost.js'))
  const files = require(path.join(dist, 'teamFileIo.js'))
  expect(require.cache[path.join(dist, 'teamCreate.js')]).toBeUndefined()
  const copy = path.join(state.folder, 'copy')
  const user = path.join(state.folder, 'user')
  await mkdir(path.join(copy, 'src'), { recursive: true })
  await mkdir(user)

  const input = {
    folder: copy,
    workspaceRoot: user,
    platform: process.platform,
    io: {
      ...host.WORKER_NATIVE_IO,
      // Linux exercises installed binary discovery. The other rigs exercise
      // their compiled native contract through the existing fixture launcher.
      ...(process.platform !== 'linux' && { workerNativeOperation }),
    },
  }
  const grant = await host.assertWorkerRoot(input)
  const io = files.fenceWorkerToolIo(
    {},
    {
      input: { ...input, grant },
      role: {
        roleId: 'engineering',
        workspaceMode: 'own-branch',
        toolGroups: ['read', 'write'],
        reportShape: 'summary',
      },
      admit: () => {
        /* The fixture has no admission conditions. */
      },
    },
  )
  const target = path.join(copy, 'src', 'new.ts')
  await io.writeFile(target, 'packaged\n')
  expect(await readFile(target, 'utf8')).toBe('packaged\n')
  expect(require.cache[path.join(dist, 'teamCreate.js')]).toBeDefined()
  const reserved = await io.reserveFile(path.join(copy, 'src', 'empty'))
  expect(await reserved.release()).toBe('done')
  const collision = path.join(copy, 'src', 'collision')
  if (process.platform === 'linux') {
    await expect(
      io.reserveFile(collision, collision, async () => {
        await writeFile(collision, 'owner')
      }),
    ).rejects.toThrow(EN.teamFileExists)
    expect(await readFile(collision, 'utf8')).toBe('owner')
  }
  // The first-use factory installs the caller's language in its own bundle.
  const table = { ...EN, teamFileExists: 'chemin déjà occupé' }
  await expect(
    require(path.join(dist, 'teamCreate.js')).createWorkerFile(
      { ...input, grant },
      target,
      {
        roleId: 'engineering',
        workspaceMode: 'own-branch',
        toolGroups: ['read', 'write'],
        reportShape: 'summary',
      },
      await host.workerPathIdentity(copy),
      host,
      table,
      'fr',
    ),
  ).rejects.toThrow('chemin déjà occupé')
})
