import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { runTests } from '@vscode/test-electron'
import { expect, it } from 'vitest'
import { isCredentialVariable } from '../../../src/core/credentialEnvironment'

// A genuine installed-editor launch, extension activation, native edits and process exit.
const INSTALLED_EDITOR_TIMEOUT_MS = 90_000

it(
  'records native editor/undo/selection/diagnostic receipts in the installed Windows VS Code',
  async () => {
    const root = path.resolve('temp/m104-pd-vscode')
    const workspace = path.join(root, 'workspace')
    const profile = path.join(root, 'profile')
    const home = path.join(root, 'home')
    const receipt = path.join(root, 'receipt.json')
    await mkdir(path.join(profile, 'User'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await mkdir(home, { recursive: true })
    await rm(receipt, { force: true })
    await writeFile(
      path.join(workspace, 'unicode space Ω.ts'),
      "const value = '😀'\r\nconst other = 2\r\n",
    )
    await writeFile(
      path.join(profile, 'User', 'settings.json'),
      JSON.stringify({
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'extensions.autoCheckUpdates': false,
        'extensions.autoUpdate': false,
        'workbench.enableExperiments': false,
        'workbench.startupEditor': 'none',
        'museSpark.backend': 'modelApi',
        'museSpark.modelApiTab': false,
        'museSpark.modelApiHooks': false,
        'museSpark.hideOnboarding': true,
        'museSpark.museBinaryPath': path.join(root, 'unavailable.exe'),
        'museSpark.webSearch': false,
        'museSpark.imageGeneration': false,
        'museSpark.museVoice': false,
        'museSpark.autoReviewer': false,
      }),
    )
    await build({
      entryPoints: ['test/m104/windows/vscodeEntry.ts'],
      outfile: path.join(root, 'entry.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['vscode'],
      logLevel: 'silent',
    })
    // This test worker never preserves credential values; the editor inherits none.
    for (const name of Object.keys(process.env))
      if (isCredentialVariable(name)) Reflect.deleteProperty(process.env, name)
    await runTests({
      vscodeExecutablePath: 'C:/Program Files/Microsoft VS Code/Code.exe',
      extensionDevelopmentPath: process.cwd(),
      extensionTestsPath: path.join(root, 'entry.js'),
      extensionTestsEnv: {
        M104_PD_RESULT: receipt,
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, 'AppData/Roaming'),
        LOCALAPPDATA: path.join(home, 'AppData/Local'),
      },
      launchArgs: [
        workspace,
        '--user-data-dir',
        profile,
        '--extensions-dir',
        path.join(root, 'extensions'),
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-gpu',
      ],
    })
    const result = JSON.parse(await readFile(receipt, 'utf8'))
    expect(result).toMatchObject({
      version: '1.139.1',
      arch: 'x64',
      platform: 'win32',
      modelAttempts: 0,
    })
    expect(result.receipts).toHaveLength(7)
  },
  INSTALLED_EDITOR_TIMEOUT_MS,
)
