// Driving the Rust virtual-input binary (M111 lane QA): finds the built
// `muse-virtual-input`, feeds it a command script inside a compositor
// session, and counts its `ok` lines. The binary is built by cargo (see
// test/desktop/harness/virtual-input/); when it is not built, callers get
// a refusal naming the build command, never a silent skip.

import path from 'node:path'
import { runCapture } from './proc.mjs'
import { findExecutable } from './tools.mjs'

export const VIRTUAL_INPUT_BINARY = 'muse-virtual-input'
export const VIRTUAL_INPUT_BUILD_HINT =
  'build it with: cargo build --release --manifest-path test/desktop/harness/virtual-input/Cargo.toml'

/**
The driver binary to run: `$MUSE_VIRTUAL_INPUT`, then the crate's
release/debug outputs under the repository, then PATH.
*/
export async function findVirtualInputBinary({ repoRoot, env = process.env }) {
  const override = env.MUSE_VIRTUAL_INPUT
  const candidates = [
    ...(override === undefined ? [] : [override]),
    path.join(repoRoot, 'test/desktop/harness/virtual-input/target/release', VIRTUAL_INPUT_BINARY),
    path.join(repoRoot, 'test/desktop/harness/virtual-input/target/debug', VIRTUAL_INPUT_BINARY),
    ...(env.CARGO_TARGET_DIR === undefined
      ? []
      : [
          path.join(env.CARGO_TARGET_DIR, 'release', VIRTUAL_INPUT_BINARY),
          path.join(env.CARGO_TARGET_DIR, 'debug', VIRTUAL_INPUT_BINARY),
        ]),
  ]
  for (const candidate of candidates) {
    const found = await findExecutable(candidate, env)
    if (found !== undefined) return found
  }
  return findExecutable(VIRTUAL_INPUT_BINARY, env)
}

/**
Runs one command script through the driver in a session environment.
Resolves with how many commands the driver acknowledged.
*/
export async function runVirtualInputScript(binary, { env, script, timeoutMs = 30_000 }) {
  if (binary === undefined) {
    throw new Error(`the virtual-input driver is not built: ${VIRTUAL_INPUT_BUILD_HINT}`)
  }
  const result = await runCapture(binary, [], { env, input: script, timeoutMs })
  if (result.code !== 0) {
    throw new Error(
      `the virtual-input driver failed (exit ${String(result.code)}): ${result.stderr.trim() || result.stdout.trim()}`,
    )
  }
  const acknowledged = result.stdout
    .split('\n')
    .filter((line) => /^ok \d+$/.test(line.trim())).length
  return { acknowledged, output: result.stdout }
}
