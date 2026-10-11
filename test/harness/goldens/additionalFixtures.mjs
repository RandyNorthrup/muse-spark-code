import { build } from 'esbuild'
import { cp, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Each entry mounts real components through the existing test-only host ports.
export const additionalScenes = {
  'accounts-section': ['accounts', 'scene=section'],
  'accounts-dialog': ['accounts', 'scene=dialog'],
  'accounts-swap': ['accounts', 'scene=swap'],
  'accounts-edit': ['accounts', 'scene=section'],
  'accounts-thresholds': ['accounts', 'scene=section'],
  'playbook-status': ['playbook', 'scene=status'],
  'playbook-notes': ['playbook', 'scene=notes'],
  'playbook-map': ['integrated', 'scene=playbook-map'],
  'estimator-result': ['estimator', ''],
  'vault-panel': ['vault', 'scenario=panel'],
  'vault-grant': ['vault', 'scenario=panel'],
  'vault-approval': ['vault', 'scenario=header'],
  'resource-controls': ['resources', 'level=pause&surface=companion'],
  'resource-task': ['resources', 'level=pause&surface=traffic'],
  'resource-history': ['resourceHistory', ''],
  'media-controls': ['integrated', 'scene=media-controls'],
  'developer-options': ['integrated', 'scene=developer-options'],
  'account-usage': ['integrated', 'scene=account-usage'],
  'reporting-page': ['integrated', 'scene=reporting-page'],
  'report-destinations': ['integrated', 'scene=report-destinations'],
  'schedule-report-action': ['integrated', 'scene=schedule-report-action'],
  'setup-preview': ['integrated', 'scene=setup-preview'],
  ...Object.fromEntries(
    ['lanes', 'leases', 'conflicts', 'mergeQueue', 'metrics'].map((tab) => [
      `traffic-${tab}`,
      ['integrated', `scene=traffic-${tab}`],
    ]),
  ),
  'usage-tokens': ['integrated', 'scene=usage-tokens'],
  'usage-detail': ['integrated', 'scene=usage-detail'],
  ...Object.fromEntries(
    [
      'savings',
      'attempts',
      'breakdown',
      'features',
      'stacked',
      'share',
      'steps',
      'burn',
      'limits',
    ].map((part) => [`usage-${part}`, ['integrated', `scene=usage-${part}`]]),
  ),
}

export async function makeAdditionalFixtures(root, directory) {
  await cp(path.join(root, 'test/harness/themes'), path.join(directory, 'themes'), {
    recursive: true,
  })
  await build({
    absWorkingDir: root,
    entryPoints: {
      accounts: 'test/harness/accounts.mjs',
      playbook: 'test/harness/playbook.mjs',
      estimator: 'test/harness/estimator/scene.tsx',
      vault: 'test/harness/vault/main.tsx',
      resources: 'test/harness/resources-entry.mjs',
      resourceHistory: 'test/harness/resource-history-entry.mjs',
      integrated: 'test/harness/goldens/integrated.tsx',
    },
    outdir: directory,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  const entries = new Set(Object.values(additionalScenes).map(([entry]) => entry))
  for (const entry of entries)
    await writeFile(
      path.join(directory, `${entry}.html`),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M114 integrated fixture</title><link rel="stylesheet" href="/dist/webview/main.css"><link rel="stylesheet" href="/dist/webview/usage.css"><link rel="stylesheet" href="/dist/webview/models.css"><link rel="stylesheet" href="${entry}.css"></head><body><main id="root"></main><script type="module" src="${entry}.js"></script></body></html>`,
    )
}
