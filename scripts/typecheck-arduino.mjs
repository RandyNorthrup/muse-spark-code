// Install the older declarations in private scratch, never alter shared node_modules.
// The full host uses this floor; newer optional APIs must be feature-detected.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

export function arduinoCompilerOptions(options, declarations) {
  return {
    ...options,
    // Do not also load the root's ambient vscode 1.99 declaration.
    types: options.types?.filter((name) => name !== 'vscode'),
    paths: { ...options.paths, vscode: [declarations] },
  }
}

function main() {
  const root = process.cwd()
  const install = path.join(root, 'temp', 'arduino-types')
  const packageFile = path.join(install, 'node_modules/@types/vscode/package.json')
  if (
    !existsSync(packageFile) ||
    JSON.parse(readFileSync(packageFile, 'utf8')).version !== '1.96.0'
  ) {
    mkdirSync(install, { recursive: true })
    for (const file of ['package.json', 'package-lock.json']) {
      copyFileSync(path.join(root, 'test/hosts/arduino-types', file), path.join(install, file))
    }
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--prefix', install], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
  }
  const declarations = path.join(install, 'node_modules/@types/vscode/index.d.ts')
  for (const project of ['tsconfig.json', 'test/integration/tsconfig.json']) {
    const config = ts.getParsedCommandLineOfConfigFile(
      path.join(root, project),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        },
      },
    )
    if (config === undefined) throw new Error(`Cannot read ${project}`)
    const program = ts.createProgram(
      config.fileNames,
      arduinoCompilerOptions(config.options, declarations),
    )
    const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)]
    if (diagnostics.length > 0) {
      console.error(
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => root,
          getNewLine: () => '\n',
        }),
      )
      process.exitCode = 1
      return
    }
    console.log(`Arduino API 1.96.0: ${project} passed`)
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main()
}
