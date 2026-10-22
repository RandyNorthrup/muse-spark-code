import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  deferredCohort,
  sharedModelApiBoundaries,
  sharedResourceAdmission,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'
import { EN } from '../../src/shared/l10n/en'
import { immediateResourceSettings } from './helpers/resources/fixtureAdmission.ts'
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
  // The packaged install stages outside the workspace, as production's
  // installed location is: main's path guard refuses a helper planted
  // inside the workspace, and the package's own copy is that helper here.
  state.folder = await mkdtemp(path.join(tmpdir(), 'team-packaged-'))
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
    // Production's team plugin set (scripts/build.mjs teamOptions):
    // sharedResourceAdmission so the team chunks launch through the
    // configured resourceAdmission.js below, never an inline copy whose
    // admission state no test configures — but no sharedExecGuard, which
    // production's team build does not use either: the fence's guard layer
    // stays inline in these chunks.
    plugins: [
      sharedUiText,
      sharedValidation,
      deferredCohort,
      sharedWire,
      sharedResourceAdmission,
      sharedModelApiBoundaries,
    ],
    entryPoints: {
      teamHost: 'src/core/team/workers/workerFence.ts',
      teamFileIo: 'src/core/team/workers/workerToolIoEntry.ts',
      teamCreate: 'src/core/team/workers/workerCreateEntry.ts',
      teamWorkerOps: 'src/core/team/workers/workerOpsEntry.ts',
    },
  })
  // The admission entry builds alone: sharedResourceAdmission recognises
  // only production's outfile layout, and would otherwise rewrite the
  // entry's own launcher import into a self-require with no exports.
  await build({
    ...options,
    plugins: [sharedUiText, sharedValidation, deferredCohort],
    entryPoints: {
      resourceAdmission: 'src/core/resources/admissionEntry.ts',
    },
  })
  await build({
    ...options,
    // sharedResourceAdmission, as in production: the process chunk launches
    // through the window's one admission state, never an inline copy.
    plugins: [sharedUiText, sharedValidation, deferredCohort, sharedResourceAdmission],
    entryPoints: {
      resourceGovernor: 'src/core/resources/resourceGovernorEntry.ts',
      resourceProcess: 'src/core/resources/resourceProcessEntry.ts',
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
  // The packaged graph admits through its own chunk: grant at once (there is
  // no contention to queue for here) and keep the real spawn, containment
  // and bounds. Queueing is proved by the governor suites, never here.
  require(path.join(state.folder, 'dist', 'resourceAdmission.js')).configureResources(
    immediateResourceSettings({
      // No settings to read and no error channel in the packaged probe.
      inspect: () => {
        /* The packaged settings reader has nothing to report. */
      },
      onError: () => {
        /* The packaged probe surfaces failures through its assertions. */
      },
    }),
  )
  if (process.platform === 'linux') {
    const directory = path.join(state.folder, 'native', 'linux', process.arch)
    await mkdir(directory, { recursive: true })
    await copyFile(path.join(nativeScratch(), 'created'), path.join(directory, 'muse-created'))
    return
  }
  // Windows keeps the compiled fixture launcher: the packaged bundle cannot
  // see this process's resourceWindowsJob mock, so the production Windows
  // launcher is executed by teamWorkerCreate.test.ts instead.
  if (process.platform !== 'darwin') return
  // macOS executes the production darwin launcher: the compiled C worker
  // beside a shim at the installed helper path. The shim only drops the
  // '--created-directory' word the Swift entry consumes in production; the
  // worker protocol bytes after it reach the real compiled helper.
  const directory = path.join(state.folder, 'native', 'darwin')
  await mkdir(directory, { recursive: true })
  await copyFile(path.join(nativeScratch(), 'created'), path.join(directory, 'muse-dictate-real'))
  await writeFile(
    path.join(directory, 'muse-dictate'),
    '#!/bin/sh\nshift\nexec "$(dirname "$0")/muse-dictate-real" "$@"\n',
    { mode: 0o755 },
  )
}, 30_000) // Compile the real native/helper bundle graph once; test deadlines remain the repository default.

afterAll(async () => {
  if (state.folder !== '') await rm(state.folder, { recursive: true, force: true })
})

it('NF packaged file adapter shares the retained grant and loads native creation only on first use', async () => {
  const dist = path.join(state.folder, 'dist')
  const host = require(path.join(dist, 'teamHost.js'))
  const files = require(path.join(dist, 'teamFileIo.js'))
  expect(require.cache[path.join(dist, 'teamCreate.js')]).toBeUndefined()
  expect(require.cache[path.join(dist, 'teamWorkerOps.js')]).toBeUndefined()
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
      // Linux and macOS exercise installed-helper discovery through the
      // production launcher. Windows exercises its compiled native contract
      // through the existing fixture launcher here (see beforeAll).
      ...(process.platform === 'win32' && { workerNativeOperation }),
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
  expect(require.cache[path.join(dist, 'teamWorkerOps.js')]).toBeDefined()
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
