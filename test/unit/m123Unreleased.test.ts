// M123 (PLAN.md D104) ships whole or not at all (the owner, 2026-10-10).
// Until its sign-in, editor leases, panel and per-editor qualification land,
// nothing of it is reachable or offered: no `museSpark.github.*` setting in
// the manifest, the defaults or the Help reference, and no native Git route
// in a VS Code-family host without `vscode.git`. Lane Q removes this file
// when it turns M123 on with F36's receipts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createGitFeatures } from '../../src/host/git/gitWindow'
import { M123_RELEASE, SETTING_DEFAULTS } from '../../src/shared/constants'
import { featureCatalog } from '../../src/shared/featureCatalog'
import { gitFeaturesDeps } from './helpers/gitFeatures'

const GITHUB_SETTING = /^(museSpark\.)?github\./

describe('M123 stays off until it is complete', () => {
  it('offers no GitHub setting in the manifest, the defaults or the Help reference', () => {
    const manifest = z
      .object({
        contributes: z.object({
          configuration: z.object({ properties: z.record(z.string(), z.unknown()) }),
        }),
      })
      .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')))
    const contributed = Object.keys(manifest.contributes.configuration.properties)
    expect(contributed.filter((key) => GITHUB_SETTING.test(key))).toEqual([])
    expect(Object.keys(SETTING_DEFAULTS).filter((key) => GITHUB_SETTING.test(key))).toEqual([])
    const listed = featureCatalog().flatMap((feature) => feature.settings)
    expect(listed.filter((key) => GITHUB_SETTING.test(key))).toEqual([])
  })

  it('gives a host without the Git extension no native Git route', () => {
    const features = createGitFeatures(gitFeaturesDeps())
    expect(features.window.nativeGit).toBeUndefined()
    expect(M123_RELEASE.isNativeGitRouteOn).toBe(false)
  })
})
