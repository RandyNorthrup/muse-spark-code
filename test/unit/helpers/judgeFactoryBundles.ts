// The real Judge entries with production sharing, in a folder owned by this file's tests.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import {
  deferredCohort,
  sharedModelApiBoundaries,
  sharedValidation,
  sharedWire,
} from '../../../scripts/lib/deferredBundles.mjs'
import { buildHostBundles } from './modelApiBundle'
import { removeFolder } from './temporaryFolders'

export function builtJudgeFactories() {
  const folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-judge-factories-')))
  const metafile = path.join(folder, 'judge-meta.json')
  beforeAll(async () => {
    await buildHostBundles(folder, {
      validation: path.resolve('src/host/validationEntry.ts'),
      validationSchema: path.resolve('src/host/validationSchemaEntry.ts'),
    })
    await buildHostBundles(
      folder,
      { modelApiBoundaries: path.resolve('src/shared/modelApiBoundariesEntry.ts') },
      [],
      undefined,
      [sharedValidation],
    )
    await buildHostBundles(
      folder,
      {
        wire: path.resolve('src/shared/wireEntry.ts'),
        providers: path.resolve('src/host/backend/providersEntry.ts'),
      },
      [],
      undefined,
      [sharedValidation, sharedModelApiBoundaries],
    )
    await buildHostBundles(
      folder,
      {
        judge: path.resolve('src/host/judge/judgeEntry.ts'),
        judgeP2: path.resolve('src/runtime/judge/judgeEntry.ts'),
        judgeSources: path.resolve('src/runtime/judge/judgeSourcesEntry.ts'),
        judgeLint: path.resolve('src/runtime/judge/judgeLintEntry.ts'),
        judgeHook: path.resolve('src/runtime/judge/judgeHookEntry.ts'),
        judgeLocal: path.resolve('src/runtime/judge/judgeLocalEntry.ts'),
        judgeUses: path.resolve('src/runtime/judge/judgeUsesEntry.ts'),
        judgeServe: path.resolve('src/runtime/judge/judgeServeEntry.ts'),
      },
      [],
      metafile,
      [sharedValidation, sharedModelApiBoundaries, sharedWire, deferredCohort],
    )
  })
  afterAll(() => removeFolder(folder))
  return { folder, metafile }
}
