// `muse-spark-code-acp --no-user-mcp-servers` (the team's own agent): the agent
// opens no session while the person's own Muse Code settings turn an MCP server
// on, because Muse Code 1.4.14 has no switch that leaves a configured server
// out for one run (`-c mcpServers.<name>.enabled=false` is refused for a name
// the settings hold). Real settings files on a real file system, the real
// argument parser, and the real packed agent's `--help`.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readTextIfPresent } from '../../src/host/fsAtomic'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { userMcpServersRefusal } from '../../src/runtime/userMcpServers'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { stageAgentBundle } from './helpers/stageAgentBundle'

setUiText(EN, 'en')

const run = promisify(execFile)

/** The guard over the settings file at `file`, read as the agent reads it. */
function refusalFor(file: string): string | undefined {
  return userMcpServersRefusal(() => readTextIfPresent(file))
}

describe('the guard over the person’s Muse Code settings', () => {
  let root: string

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'no-user-mcp-')))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function settings(name: string, content: unknown): Promise<string> {
    const folder = path.join(root, name)
    await mkdir(folder, { recursive: true })
    const file = path.join(folder, 'settings.json')
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
    return file
  }

  it('lets a session open when the settings turn no MCP server on', async () => {
    expect(refusalFor(path.join(root, 'no-file', 'settings.json'))).toBeUndefined()
    expect(refusalFor(await settings('empty', { schema_version: 1 }))).toBeUndefined()
    expect(
      refusalFor(
        await settings('off', {
          schema_version: 1,
          mcpServers: { docs: { command: 'node', enabled: false } },
        }),
      ),
    ).toBeUndefined()
  })

  it('refuses in words while any MCP server is on, under either spelling of the key', async () => {
    expect(
      refusalFor(
        await settings('on', {
          schema_version: 1,
          mcpServers: {
            docs: { command: 'node', enabled: false },
            tracker: { url: 'https://example.invalid/mcp' },
          },
        }),
      ),
    ).toBe(UI_TEXT.acpUserMcpServersConfigured)
    expect(
      refusalFor(
        await settings('legacy', { schema_version: 1, mcp_servers: { docs: { command: 'node' } } }),
      ),
    ).toBe(UI_TEXT.acpUserMcpServersConfigured)
  })

  it('refuses when the settings cannot show that they hold none', async () => {
    expect(refusalFor(await settings('broken', '{"mcpServers": '))).toBe(
      UI_TEXT.acpUserMcpServersUnreadable,
    )
    // A folder where the file belongs: the file system itself refuses the read.
    const folderInPlace = path.join(root, 'folder-in-place', 'settings.json')
    await mkdir(folderInPlace, { recursive: true })
    expect(refusalFor(folderInPlace)).toBe(UI_TEXT.acpUserMcpServersUnreadable)
  })
})

describe('the flag', () => {
  it('is a serve flag the parser hands to the agent', () => {
    expect(parseCommandLine(['--no-user-mcp-servers'])).toMatchObject({
      command: 'serve',
      options: { noUserMcpServers: true },
    })
    const plain = parseCommandLine([])
    expect(plain).toMatchObject({ command: 'serve' })
    expect(plain).not.toHaveProperty('options.noUserMcpServers')
  })

  describe('in the packed agent', () => {
    let directory: string
    let agent: string

    beforeAll(async () => {
      directory = await realpath(await mkdtemp(path.join(tmpdir(), 'no-user-mcp-agent-')))
      agent = await stageAgentBundle(directory)
      await symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir')
    })
    afterAll(async () => {
      await rm(directory, { recursive: true, force: true })
    })

    async function output(...args: string[]): Promise<string> {
      const { stdout } = await run(process.execPath, [agent, ...args], {
        env: { PATH: process.env['PATH'] },
      })
      return stdout
    }

    it('is named by the agent’s help and described by its serve topic', async () => {
      expect(await output('--help')).toContain('--no-user-mcp-servers')
      expect(await output('help', 'serve')).toContain(
        `--no-user-mcp-servers  ${EN.referenceCliOptions['no-user-mcp-servers'].replace(/^--no-user-mcp-servers\s+/, '')}`,
      )
    })
  })
})
