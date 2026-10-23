import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(host, '../..')
const generated = path.join(host, 'Generated')
await mkdir(generated, { recursive: true })
await mkdir(path.join(root, 'temp/m104x'), { recursive: true })
const modulePath = path.join(root, 'temp/m104x/nativeTables.mjs')
await build({
  entryPoints: [path.join(host, 'Scripts/nativeTables.ts')],
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})
const { nativeTables, escapeHtml } = await import(pathToFileURL(modulePath).href)
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const contract = await readFile(path.join(root, 'src/shared/hostApi/mhp-v1.1.schema.json'), 'utf8')
if (JSON.parse(contract).protocol !== nativeTables.mhp.version) throw new Error('MHP_VERSION_LOCK')
await writeFile(path.join(generated, 'mhp.json'), contract)
await writeFile(
  path.join(generated, 'NativeMhp.swift'),
  `// Generated from the reviewed MHP constants and product manifest.\nimport Foundation\nenum NativeMhp {\n${Object.entries(
    nativeTables.mhp,
  )
    .map(([key, value]) => `  static let ${key} = ${JSON.stringify(value)}`)
    .join('\n')}\n  static let productVersion = ${JSON.stringify(manifest.version)}\n}\n`,
)
const keys = [
  'xcodeTitle',
  'xcodeOpenWorkspace',
  'xcodeRuntime',
  'xcodeOpenPanel',
  'xcodeAsk',
  'xcodeExplain',
  'xcodeFix',
  'xcodeTab',
  'xcodeApprove',
  'xcodeReplacement',
  'xcodeUnavailable',
  'xcodeStartFailed',
  'xcodeEditRefused',
  'xcodeRuntimeNeeded',
  'xcodeOpenFile',
  'openFileFailed',
  'xcodeWorkspaceRequired',
  'xcodeChooseRuntime',
  'xcodeDenied',
  'stopTitle',
  'composerLabel',
  'questionCancel',
  'companionLaunchFailed',
  'linkOutsideWorkspace',
  'worktreeTrustAction',
  'worktreeTrustConfirm',
  'worktreeTrustDetail',
  'fallbackContinue',
]
const tables = { en: nativeTables.english }
for (const language of [
  'cs',
  'de',
  'es',
  'fr',
  'hu',
  'it',
  'ja',
  'ko',
  'pl',
  'pt-br',
  'ru',
  'tr',
  'zh-cn',
  'zh-tw',
]) {
  tables[language] = JSON.parse(await readFile(path.join(root, `l10n/ui.${language}.json`), 'utf8'))
}
for (const [language, table] of Object.entries(tables)) {
  const subset = Object.fromEntries(
    keys.map((key) => {
      if (typeof table[key] !== 'string') throw new TypeError(`ENATIVE_TEXT:${language}:${key}`)
      return [key, table[key]]
    }),
  )
  await writeFile(
    path.join(generated, `ui.${language}.json`),
    `${JSON.stringify(subset, null, 2)}\n`,
  )
}
const limits = Object.entries(nativeTables.limits)
  .map(([key, value]) => `    static let ${key} = ${value}`)
  .join('\n')
await writeFile(
  path.join(generated, 'NativeLimits.swift'),
  `// Generated from src/shared/constants.ts; run Scripts/generate.mjs.\nimport Foundation\nenum NativeLimits {\n${limits}\n    static let forbiddenEnvironment: Set<String> = ${JSON.stringify(nativeTables.forbidden)}\n}\n`,
)
const modelText = Object.entries(nativeTables.modelText)
  .map(([key, value]) => `    static let ${key} = ${JSON.stringify(value)}`)
  .join('\n')
await writeFile(
  path.join(generated, 'NativeModelText.swift'),
  `// Generated from the native-only XCODE_MODEL_TEXT block.\nimport Foundation\nenum NativeModelText {\n${modelText}\n}\n`,
)
// XML character data admits the same five entities as the shared serializer.
const brand = escapeHtml(nativeTables.english.xcodeTitle)
const header =
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'
const base = `<key>CFBundleDevelopmentRegion</key><string>en</string><key>CFBundleDisplayName</key><string>${brand}</string><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleInfoDictionaryVersion</key><string>6.0</string><key>CFBundleName</key><string>${brand}</string><key>CFBundleShortVersionString</key><string>${escapeHtml(manifest.version)}</string><key>CFBundleVersion</key><string>1</string>`
await writeFile(
  path.join(generated, 'App-Info.plist'),
  `${header}${base}<key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSPrincipalClass</key><string>NSApplication</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>muse-spark-xcode</string></array></dict></array><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>\n`,
)
const commands = [
  ['ask', 'xcodeAsk'],
  ['explain', 'xcodeExplain'],
  ['fix', 'xcodeFix'],
  ['tab', 'xcodeTab'],
  ['open', 'xcodeOpenPanel'],
]
  .map(
    ([id, key]) =>
      `<dict><key>XCSourceEditorCommandClassName</key><string>$(PRODUCT_MODULE_NAME).SourceEditorCommand</string><key>XCSourceEditorCommandIdentifier</key><string>org.muse-spark-code.xcode.${id}</string><key>XCSourceEditorCommandName</key><string>${escapeHtml(nativeTables.english[key])}</string></dict>`,
  )
  .join('')
await writeFile(
  path.join(generated, 'Extension-Info.plist'),
  `${header}${base}<key>CFBundlePackageType</key><string>XPC!</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.dt.Xcode.extension.source-editor</string><key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).SourceEditorExtension</string><key>NSExtensionAttributes</key><dict><key>XCSourceEditorCommandDefinitions</key><array>${commands}</array></dict></dict></dict></plist>\n`,
)

const testPlan = {
  configurations: [{ id: '70EE3AC1-4C97-4F88-9D6C-091A53724685', name: 'Native', options: {} }],
  defaultOptions: {
    testTimeoutsEnabled: true,
    environmentVariableEntries: [
      { key: 'MUSE_XCODE_RUNTIME', value: path.join(root, 'temp/m104x/fake-runtime') },
      { key: 'MUSE_XCODE_WORKSPACE', value: root },
      { key: 'MUSE_UI_LANGUAGE', value: 'en' },
    ],
  },
  testTargets: [
    {
      target: {
        containerPath: 'container:MuseSpark.xcodeproj',
        identifier: '7B57A55F47D75E80AA76F38E',
        name: 'NativeHostTests',
      },
    },
    {
      target: {
        containerPath: 'container:MuseSpark.xcodeproj',
        identifier: '46DCEE19E87DC72D185224AA',
        name: 'PanelUITests',
      },
    },
  ],
  version: 1,
}
await writeFile(
  path.join(generated, 'NativeTests.xctestplan'),
  `${JSON.stringify(testPlan, null, 2)}\n`,
)
