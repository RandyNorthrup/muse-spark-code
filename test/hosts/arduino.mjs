// Install into a private test home's ~/.arduinoIDE/plugins/, then drive
// the real IDE's extensionTestsPath hook. The user's IDE settings stay untouched.
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright-core'
import { readVSIXPackage } from '@vscode/vsce/out/zip.js'

const [executable, archive, directory] = process.argv.slice(2)
if (!executable || !archive || !directory) {
  throw new Error('Usage: arduino.mjs IDE_EXECUTABLE ARDUINO_VSIX WORK')
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testCliRunner = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@vscode/test-cli')),
  'runner.cjs',
)
const work = path.resolve(directory)
// Refuse an existing test home: do not reuse a result or delete user state.
const testHome = path.join(work, 'home')
if (existsSync(testHome)) throw new Error('Use a fresh Arduino test work directory')
const { manifest } = await readVSIXPackage(path.resolve(archive))
if (manifest.engines.vscode !== '^1.96.0' || manifest.engines.node !== '>=20.14.0') {
  throw new Error('The host check requires the Arduino VSIX')
}
const offlineCache = process.env.MUSE_ARDUINO_OFFLINE_CACHE
const cacheIndexes = [
  'package_index.json',
  'package_index.json.sig',
  'library_index.json',
  'library_index.json.sig',
]
if (offlineCache !== undefined) {
  for (const file of cacheIndexes) {
    if (!existsSync(path.join(offlineCache, 'arduino-data', file)))
      throw new Error(`Offline Arduino cache is missing ${file}`)
  }
}
const config = path.join(testHome, '.arduinoIDE')
const plugins = path.join(config, 'plugins')
const extension = path.join(plugins, 'muse-spark-code')
const workspace = path.join(testHome, 'Arduino', 'workspace')
mkdirSync(plugins, { recursive: true })
mkdirSync(workspace, { recursive: true })
execFileSync('unzip', [
  '-q',
  path.resolve(archive),
  'extension/*',
  '-d',
  path.join(work, 'unpacked'),
])
cpSync(path.join(work, 'unpacked/extension'), extension, { recursive: true })
cpSync(path.join(root, 'test/fixtures/workspace'), workspace, { recursive: true })
writeFileSync(path.join(workspace, 'workspace.ino'), 'void setup() {}\nvoid loop() {}\n')
const fakeMuse = execFileSync(
  'sh',
  [path.join(root, 'test/hosts/fake-muse.sh'), path.join(work, 'fake-muse')],
  { encoding: 'utf8' },
).trim()
writeFileSync(
  path.join(config, 'settings.json'),
  JSON.stringify({
    'museSpark.museBinaryPath': fakeMuse,
    'security.workspace.trust.enabled': false,
    'museSpark.showWhatsNewOnUpdate': false,
    'arduino.checkForUpdates': false,
  }),
)
writeFileSync(
  path.join(config, 'arduino-cli.yaml'),
  [
    'directories:',
    `  data: ${JSON.stringify(path.join(work, 'arduino-data'))}`,
    `  downloads: ${JSON.stringify(path.join(work, 'arduino-downloads'))}`,
    `  user: ${JSON.stringify(path.join(testHome, 'Arduino'))}`,
  ].join('\n'),
)
// Production product bytes stay intact; only test bundles are added to this fixture.
const integration = path.join(extension, 'dist/test/integration')
cpSync(path.join(root, 'dist/test/integration'), integration, { recursive: true })
const runner = path.join(extension, 'dist/test/hosts/arduino-runner.cjs')
await build({
  entryPoints: [path.join(root, 'test/hosts/arduino-test-runner.mjs')],
  outfile: runner,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20.14',
  external: ['vscode'],
})
const resultFile = path.join(work, 'integration-result.json')
rmSync(resultFile, { force: true })
// An explicit public CLI cache permits offline qualification. Copy only
// board/tool/library assets and indexes, never account or credential files.
let proxy
let egress
if (offlineCache !== undefined) {
  for (const file of cacheIndexes) {
    const source = path.join(offlineCache, 'arduino-data', file)
    mkdirSync(path.join(work, 'arduino-data'), { recursive: true })
    cpSync(source, path.join(work, 'arduino-data', file))
  }
  for (const folder of ['packages', 'libraries']) {
    const source = path.join(offlineCache, 'arduino-data', folder)
    if (existsSync(source))
      cpSync(source, path.join(work, 'arduino-data', folder), { recursive: true })
  }
  const downloads = path.join(offlineCache, 'arduino-downloads')
  if (existsSync(downloads))
    cpSync(downloads, path.join(work, 'arduino-downloads'), { recursive: true })
  egress = createServer((_request, response) => {
    response.writeHead(403)
    response.end()
  })
  egress.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  await new Promise((resolve) => egress.listen(0, '127.0.0.1', resolve))
  const address = egress.address()
  if (address === null || typeof address === 'string') throw new Error('No private egress address')
  proxy = `http://127.0.0.1:${address.port}`
}
const app = await electron.launch({
  executablePath: path.resolve(executable),
  args: [
    `--user-data-dir=${path.join(work, 'electron-data')}`,
    `--plugins=local-dir:${plugins}`,
    `--extensionTestsPath=${runner}`,
    '--no-sandbox',
    '--disable-gpu',
    ...(proxy === undefined ? [] : [`--proxy-server=${proxy}`]),
    path.join(workspace, 'workspace.ino'),
  ],
  env: {
    ...process.env,
    THEIA_CONFIG_DIR: config,
    ARDUINO_DIRECTORIES_DATA: path.join(work, 'arduino-data'),
    ARDUINO_DIRECTORIES_DOWNLOADS: path.join(work, 'arduino-downloads'),
    ARDUINO_DIRECTORIES_USER: path.join(testHome, 'Arduino'),
    ...(proxy !== undefined && {
      ARDUINO_NETWORK_PROXY: proxy,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      NO_PROXY: '127.0.0.1,localhost,::1',
      http_proxy: proxy,
      https_proxy: proxy,
      no_proxy: '127.0.0.1,localhost,::1',
    }),
    XDG_CONFIG_HOME: path.join(work, 'fake-muse/config'),
    MUSE_ARDUINO_RESULT: resultFile,
    MUSE_HOST_CAPTURE: path.join(work, 'rename-commands.json'),
    MUSE_ARDUINO_TEST_CLI_RUNNER: testCliRunner,
  },
  timeout: 120_000,
})
const log = []
app.process().stdout?.on('data', (bytes) => {
  log.push(bytes.toString())
  writeFileSync(path.join(work, 'arduino.log'), log.join(''))
})
app.process().stderr?.on('data', (bytes) => {
  log.push(bytes.toString())
  writeFileSync(path.join(work, 'arduino.log'), log.join(''))
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const deadline = Date.now() + 15 * 60_000
  while (!existsSync(resultFile) && Date.now() < deadline) {
    await setTimeout(500)
  }
  await page.screenshot({ path: path.join(work, 'arduino.png') })
  if (!existsSync(resultFile))
    throw new Error('Arduino integration runner did not return within 15 minutes')
  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log(JSON.stringify({ stats: result.stats, error: result.error }, null, 2))
  if (
    result.error ||
    !Number.isSafeInteger(result.stats?.tests) ||
    result.stats.tests <= 0 ||
    result.stats.passes !== result.stats.tests ||
    result.stats.pending !== 0 ||
    result.stats.failures !== 0
  )
    throw new Error('Arduino integration tests failed')
} finally {
  writeFileSync(path.join(work, 'arduino.log'), log.join(''))
  const close = async () => {
    await app.close()
    return true
  }
  const isClosed = await Promise.race([close(), setTimeout(10_000, false, { ref: false })])
  if (!isClosed) app.process().kill('SIGKILL')
  if (egress !== undefined) {
    egress.closeAllConnections()
    await new Promise((resolve, reject) =>
      egress.close((error) => (error ? reject(error) : resolve())),
    )
  }
}
