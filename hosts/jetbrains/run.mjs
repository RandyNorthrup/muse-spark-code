import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

// cleanTest first: without it a previous run's up-to-date test task skips
// execution and the suite never rewrites its observations.
const run = (suite, ...flags) =>
  ['./gradlew', '-p', '.', 'cleanTest', 'test', '--tests', suite, '--no-daemon', ...flags].join(' ')

// The legs run in a headless IDE (its diagnostics leg waits on the headless
// daemon); the panel suite loads the real JCEF page, which needs the native
// UI (-PnativeUi=true) and so a display: Xvfb. One test JVM cannot be both.
await conformHost({
  host: 'jetbrains',
  tool: ['xvfb-run', 'sh', './gradlew', 'java', 'node'],
  need: 'Linux with Xvfb, JDK 21 with the IntelliJ platform test framework (Gradle harness) and Node.js',
  args: [
    '-a',
    'sh',
    '-c',
    `${run('io.musespark.conformance.ConformanceSuite')} && ${run('io.musespark.conformance.PanelConformanceSuite', '-PnativeUi=true')}`,
  ],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  jdk: true,
})
