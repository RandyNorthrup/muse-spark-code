import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildNodeAuth } from '../../scripts/lib/buildNodeAuth.mjs'
import {
  checkNodeAuthArtifact,
  checkNodeAuthSplit,
  nodeAuthNotices,
} from '../../scripts/lib/nodeAuthArtifacts.mjs'

const context = { sizes: undefined, browser: undefined, server: undefined }
beforeAll(async () => {
  context.sizes = await buildNodeAuth()
  context.browser = JSON.parse(await readFile('dist/meta-node-auth/nodeAuthPage.json', 'utf8'))
  context.server = JSON.parse(await readFile('dist/meta-node-auth/nodeAuth.json', 'utf8'))
})

describe('A1 lazy production artifacts', () => {
  it('builds both real bundles under separate budgets and keeps SDKs on their own side', async () => {
    expect(context.sizes.map((item) => item.file)).toEqual([
      'dist/nodeAuth.js',
      'dist/nodeAuthPage.js',
    ])
    for (const item of context.sizes) expect(item.sizeKiB).toBeLessThanOrEqual(item.budgetKiB)
    const inputs = Object.keys(context.browser.inputs).map((file) => file.replaceAll('\\', '/'))
    expect(inputs.some((file) => file.includes('@simplewebauthn/browser/'))).toBe(true)
    expect(inputs.some((file) => file.includes('@simplewebauthn/server/'))).toBe(false)
    expect(
      Object.keys(context.server.inputs).some((file) => file.includes('@simplewebauthn/server/')),
    ).toBe(true)
    const notices = await readFile('dist/NODE_AUTH_NOTICES.txt', 'utf8')
    for (const name of ['@simplewebauthn/server', '@simplewebauthn/browser', 'react', 'zod'])
      expect(notices).toContain(`${name} (`)
    expect(notices).toContain('Permission is hereby granted')
  })
  it.each(['nodeAuth.js', 'nodeAuthPage.js'])('refuses an over-budget %s', (name) => {
    const item = context.sizes.find((size) => size.file.endsWith(name))
    expect(() =>
      checkNodeAuthArtifact(
        {
          output: item.file,
          budgetKiB: item.budgetKiB,
          platform: name === 'nodeAuthPage.js' ? 'browser' : 'node',
        },
        item.budgetKiB + 1,
        [],
      ),
    ).toThrow('exceeds')
  })
  it('refuses runtime and server SDK input in the browser, including Windows paths', () => {
    const item = context.sizes[1]
    for (const input of [
      'src/runtime/node/auth/service.ts',
      'node_modules/@simplewebauthn/server/esm/index.js',
      String.raw`src\runtime\node\tls\certificate.ts`,
    ]) {
      expect(() =>
        checkNodeAuthArtifact(
          { output: item.file, budgetKiB: item.budgetKiB, platform: 'browser' },
          item.sizeKiB,
          [...Object.keys(context.browser.inputs), input],
        ),
      ).toThrow('Server code')
    }
  })
  it('refuses A1 code in existing activation, ACP, node and webview bundles', () => {
    for (const input of [
      'src/runtime/node/auth/passkeys.ts',
      'src/runtime/node/tls/certificate.ts',
      'src/webview/node/auth/client.ts',
      String.raw`src\webview\node\auth\Pairing.tsx`,
    ])
      expect(() => checkNodeAuthSplit([input], 'existing bundle')).toThrow('lazy code')
    expect(() => checkNodeAuthSplit(['src/runtime/node/main.ts'], 'existing bundle')).not.toThrow()
  })
  it.each(['GPL-3.0', 'MIT-without-license-file'])(
    'refuses %s bundled notices',
    async (license) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'node-auth-notice-'))
      try {
        const directory = path.join(root, 'node_modules', 'fixture')
        await mkdir(directory, { recursive: true })
        await writeFile(
          path.join(directory, 'package.json'),
          JSON.stringify({ name: 'fixture', license: license === 'GPL-3.0' ? license : 'MIT' }),
        )
        const meta = {
          outputs: { 'fixture.js': { inputs: { [path.join(directory, 'index.js')]: {} } } },
        }
        await expect(nodeAuthNotices([meta])).rejects.toThrow(
          license === 'GPL-3.0' ? 'Unapproved bundled license' : 'Missing bundled license',
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
