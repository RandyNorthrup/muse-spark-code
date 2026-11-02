import path from 'node:path'
import { build } from 'esbuild'
import { compactBrowserEnglish } from '../../../scripts/lib/uiTextRegions.mjs'
import {
  sharedModelApiBoundaries,
  sharedUiText,
  sharedValidation,
  sharedWire,
  deferredCohort,
  sharedResourceAdmission,
  sharedVaultStore,
  sharedVaultPosix,
  sharedVaultWindows,
} from '../../../scripts/lib/deferredBundles.mjs'
import { withFoldedConstants } from '../../../scripts/lib/foldedConstants.mjs'

/**
W uses these same entries/options in the joined build; existing entry budgets
are unchanged. The folded-constants plugin is part of those options: every
production bundle compiles constants.ts folded (scripts/build.mjs), and
without it this guard build carries kilobytes the shipped chunk never has.
*/
export async function buildVaultSurfaces(outdir, hasHarness = false) {
  const browser = await build(
    withFoldedConstants({
      entryPoints: {
        main: 'src/webview/main.tsx',
        models: 'src/webview/models/sections/vault/VaultSurface.tsx',
        ...(hasHarness && {
          vaultHarness: 'test/harness/vault/main.tsx',
          // C-M109-1 P1's mounted scenes ride their own entry, so the U
          // guard build (without the harness) stays byte-identical.
          mounted: 'test/harness/vault/mounted.tsx',
        }),
      },
      outdir,
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      splitting: true,
      chunkNames: 'chunks/[name]-[hash]',
      target: 'chrome128',
      jsx: 'automatic',
      charset: 'utf8',
      plugins: [compactBrowserEnglish],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    }),
  )
  const host = await build(
    withFoldedConstants({
      entryPoints: ['src/host/vscode/vault/vaultPanelEntry.ts'],
      outfile: path.join(outdir, 'vault.js'),
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      external: ['vscode'],
      plugins: [
        sharedUiText,
        sharedValidation,
        sharedWire,
        sharedModelApiBoundaries,
        deferredCohort,
        sharedResourceAdmission,
        sharedVaultStore,
        sharedVaultPosix,
        sharedVaultWindows,
      ],
      logLevel: 'silent',
    }),
  )
  // RVAPP-CM1091D5 BYTES: the explicit-action code loads on the first action
  // that needs it, never when the panel opens.
  const actions = await build(
    withFoldedConstants({
      entryPoints: ['src/host/vault/vaultActionsEntry.ts'],
      outfile: path.join(outdir, 'vaultActions.js'),
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      external: ['vscode'],
      plugins: [sharedUiText, sharedValidation, sharedWire, sharedModelApiBoundaries],
      logLevel: 'silent',
    }),
  )
  // The key-store migration's own chunk loads on the first unlock edge,
  // never with the panel or at activation.
  const migration = await build(
    withFoldedConstants({
      entryPoints: ['src/host/vault/vaultMigrationEntry.ts'],
      outfile: path.join(outdir, 'vaultMigration.js'),
      bundle: true,
      minify: true,
      metafile: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      external: ['vscode'],
      plugins: [sharedUiText, sharedValidation, sharedWire, sharedModelApiBoundaries],
      logLevel: 'silent',
    }),
  )
  return {
    browser: browser.metafile,
    host: host.metafile,
    actions: actions.metafile,
    migration: migration.metafile,
  }
}
