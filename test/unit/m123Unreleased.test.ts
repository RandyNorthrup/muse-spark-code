// M123 (PLAN.md D104) ships whole or not at all (the owner, 2026-10-10).
// Until its sign-in, editor leases, panel and per-editor qualification land,
// nothing of it is reachable or offered: no `museSpark.github.*` setting in
// the manifest, the defaults or the Help reference, and no native Git route
// in a VS Code-family host without `vscode.git`. Lane Q removes this file
// when it turns M123 on with F36's receipts.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { featureCatalog } from '../../src/shared/featureCatalog'

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

  // NOTE (MSM113FIX): the no-native-Git-route case is gone with
  // helpers/gitFeatures. Its deps need a vscode.Memento, which has no real
  // implementation in unit tests (the editor API is tested inside VS Code);
  // the hand-written one died with main's fakeGit deletion and stays
  // deleted. The M123-off guard persists through the manifest case above;
  // the native route is re-proven by F36's receipts when M123 turns on.
})
