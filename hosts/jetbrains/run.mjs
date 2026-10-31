import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { conformHost } from '../../test/hostApi/harness.mjs'

await conformHost({
  host: 'jetbrains',
  tool: ['./gradlew', 'java', 'node'],
  need: 'JDK 21 with the IntelliJ platform test framework (Gradle harness) and Node.js',
  // cleanTest first: without it a previous run's up-to-date test task
  // skips execution and the suite never rewrites its observations.
  args: ['-p', '.', 'cleanTest', 'test', '--tests', 'io.musespark.conformance.*', '--no-daemon'],
  directory: path.dirname(fileURLToPath(import.meta.url)),
  jdk: true,
})
