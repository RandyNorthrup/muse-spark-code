// The editor host's own variables (M116, review RVCM1166B): one list for
// every child's environment, matched by the platform's own rule for a
// variable's name. On Windows a name has no case, and a child reads
// `electron_run_as_node` as Electron's switch all the same.
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { isHostOnlyVariable, withoutHostVariables } from '../../src/core/hostVariables'
import { shellEnvironment } from '../../src/host/backend/toolIo'
import {
  EXTENSION_HOST_VARIABLES,
  hostNames,
  LOWER_CASE_HOST_VARIABLES,
} from './helpers/playbook/hostVariables'

/** Host variables in mixed case, one of each kind the list names. */
const MIXED_CASE = {
  Electron_Run_As_Node: '1',
  VSCode_Ipc_Hook: 'fixture-only',
  Snap: '/snap/code/1',
  Gdk_Pixbuf_Module_File: '/snap/loaders.cache',
}

describe('the editor host’s own variables', () => {
  it('are the host’s on Windows however their names are cased', () => {
    // The five names VS Code's terminal keeps for the person stay, in any case too.
    const kept = { Path: String.raw`C:\Windows`, vscode_portable: String.raw`D:\portable` }
    const env = { ...kept, ...LOWER_CASE_HOST_VARIABLES, ...MIXED_CASE }
    expect(withoutHostVariables(env, 'win32')).toEqual(kept)
    for (const name of [...Object.keys(LOWER_CASE_HOST_VARIABLES), ...Object.keys(MIXED_CASE)])
      expect(isHostOnlyVariable(name, 'win32'), name).toBe(true)
    // A name that only looks alike is nobody's.
    expect(isHostOnlyVariable('electronics', 'win32')).toBe(false)
  })

  it('are matched as they are spelled where a name has case', () => {
    // On Linux and macOS `electron_run_as_node` is another variable, and no switch of Electron's.
    for (const platform of ['linux', 'darwin'] as const) {
      expect(
        withoutHostVariables(
          { ...LOWER_CASE_HOST_VARIABLES, ...EXTENSION_HOST_VARIABLES },
          platform,
        ),
      ).toEqual(LOWER_CASE_HOST_VARIABLES)
      expect(isHostOnlyVariable('ELECTRON_RUN_AS_NODE', platform)).toBe(true)
    }
  })

  it('never reach a shell tool’s command on Windows, in any case, by the same list', () => {
    const env = shellEnvironment(
      { Path: String.raw`C:\Windows`, ...LOWER_CASE_HOST_VARIABLES, ...MIXED_CASE },
      'win32',
      undefined,
    )
    expect(hostNames(env)).toEqual([])
    expect(Object.keys(env).filter((name) => /^(?:snap|gdk_pixbuf)/iu.test(name))).toEqual([])
    expect(env).toHaveProperty('Path')
  })

  it.runIf(process.platform === 'win32')(
    'leave a real Windows child with no switch to read, whatever case the host spelled it in',
    () => {
      const read =
        'process.stdout.write(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE ?? null, process.env.VSCODE_IPC_HOOK ?? null]))'
      const given = { ...process.env, electron_run_as_node: '1', vscode_ipc_hook: 'fixture-only' }
      // Unfiltered, the child reads both through their upper-case names: Windows has no case.
      const leaked = spawnSync(process.execPath, ['-e', read], { env: given, encoding: 'utf8' })
      expect(JSON.parse(leaked.stdout)).toEqual(['1', 'fixture-only'])
      const clean = spawnSync(process.execPath, ['-e', read], {
        env: withoutHostVariables(given),
        encoding: 'utf8',
      })
      expect(JSON.parse(clean.stdout)).toEqual([null, null])
    },
  )
})
