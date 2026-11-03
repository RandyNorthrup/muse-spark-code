import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'jetbrains',
  tool: ['xvfb-run', './gradlew', 'java', 'node'],
  need: 'Linux with Xvfb, JDK 21 with the IntelliJ platform test framework (Gradle harness) and Node.js',
  // cleanTest first: without it a previous run's up-to-date test task
  // skips execution and the suite never rewrites its observations.
  // -PnativeUi=true under Xvfb: the panel suite loads the real JCEF page.
  args: [
    '-a',
    './gradlew',
    '-p',
    '.',
    'cleanTest',
    'test',
    '--tests',
    'io.musespark.conformance.*',
    '--no-daemon',
    '-PnativeUi=true',
  ],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  jdk: true,
})
