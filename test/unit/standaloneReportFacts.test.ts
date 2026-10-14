import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectReportFacts } from '../../src/runtime/reportCommand'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('standalone problem report facts', () => {
  it('reads the CLI version and contributor mode beside the real files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'standalone-facts-'))
    roots.push(root)
    const bin = path.join(root, 'bin')
    const home = path.join(root, 'home')
    await mkdir(path.join(home, '.config', 'muse'), { recursive: true })
    await mkdir(bin, { recursive: true })
    await writeFile(path.join(bin, 'muse'), '')
    await writeFile(path.join(bin, '.muse-version'), '1.4.6-R6000.1\n')
    await writeFile(
      path.join(home, '.config', 'muse', 'settings.json'),
      JSON.stringify({ contributor_mode_enabled: true, schema_version: 1 }),
    )
    const facts = collectReportFacts({
      version: '0.0.0-test',
      nodeVersion: 'v24.0.0',
      platform: 'linux',
      pathEntries: [bin],
      homeDir: home,
      localAppData: undefined,
      xdgConfigHome: undefined,
      museBinaryPath: '',
      fileExists: (file) => {
        try {
          return existsSync(file)
        } catch {
          return false
        }
      },
      readTextFile: (file) => {
        try {
          return readFileSync(file, 'utf8')
        } catch {
          return undefined
        }
      },
      listDirectory: (directory) => {
        try {
          return readdirSync(directory)
        } catch {
          return []
        }
      },
      hasEnvironmentApiKey: false,
      hasStoredApiKey: false,
    })
    expect(facts.cliFound).toBe(true)
    expect(facts.cliVersion).toBe('1.4.6-R6000.1')
    expect(facts.contributorMode).toBe(true)
  })

  it('leaves contributor mode unknown when the CLI settings say nothing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'standalone-facts-absent-'))
    roots.push(root)
    const facts = collectReportFacts({
      version: '0.0.0-test',
      nodeVersion: 'v24.0.0',
      platform: 'linux',
      pathEntries: [],
      homeDir: root,
      localAppData: undefined,
      xdgConfigHome: undefined,
      museBinaryPath: '',
      fileExists: () => false,
      readTextFile: () => undefined,
      listDirectory: () => [],
      hasEnvironmentApiKey: false,
      hasStoredApiKey: false,
    })
    expect(facts.cliFound).toBe(false)
    expect(facts.cliVersion).toBeUndefined()
    expect(facts.contributorMode).toBeUndefined()
  })
})
