import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { vaultPeerExecutable } from '../../../../src/runtime/vault/posixNative'

/**
Compile the POSIX peer and bundle broker fixture children: each pair is a
helper entry and its dist output, built with the generated admission.
*/
export async function buildBrokerChildren(
  root: string,
  pairs: readonly (readonly [entry: string, output: string])[],
): Promise<void> {
  const helper = vaultPeerExecutable(root)
  await mkdir(path.dirname(helper), { recursive: true })
  await mkdir(path.join(root, 'dist'))
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'native/posix/vaultPeer.c',
    '-o',
    helper,
  ])
  for (const [entry, output] of pairs) {
    if (!entry || !output) throw new Error('missing generated build pair')
    await build({
      entryPoints: [`test/unit/helpers/vault/${entry}.ts`],
      outfile: path.join(root, 'dist', output),
      bundle: true,
      external: ['@napi-rs/keyring'],
      define: { 'require.main': 'undefined' },
      platform: 'node',
      format: 'cjs',
      plugins: [
        {
          name: 'generated-admission',
          setup(builder) {
            builder.onResolve({ filter: /admission(?:\.js)?$/ }, () => ({
              path: path.resolve('test/unit/helpers/vault/sessionAdmission.ts'),
            }))
          },
        },
      ],
    })
  }
}
