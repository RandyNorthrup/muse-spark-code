// CI/developer build only: users run the prebuilt helper and never compile it.
import { build as compile } from 'esbuild'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm, copyFile, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
  throw new Error('The Linux dictation build requires Linux x64 or arm64')
const SOURCE_URL = 'https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v1.7.6'
const SOURCE_SHA256 = '166140e9a6d8a36f787a2bd77f8f44dd64874f12dd8359ff7c1f4f9acb86202e'
const scratch = await mkdtemp(path.join(tmpdir(), 'muse-dictation-build-'))
try {
  let source = process.argv[2] === '--source' ? process.argv[3] : undefined
  if (source === undefined) {
    const response = await fetch(SOURCE_URL, { signal: globalThis.AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error('Whisper source download failed')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== SOURCE_SHA256)
      throw new Error('Whisper source SHA-256 mismatch')
    const archive = path.join(scratch, 'source.tgz')
    await writeFile(archive, bytes)
    execFileSync('tar', ['-xzf', archive, '-C', scratch], { stdio: 'inherit' })
    source = path.join(scratch, 'whisper.cpp-1.7.6')
  }
  const compiled = await compile({
    stdin: {
      contents: "export { LINUX_DICTATION } from './src/shared/constants.ts'",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const { LINUX_DICTATION: pin } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  )
  await writeFile(
    path.join(scratch, 'muse_config.hpp'),
    `#pragma once
namespace muse_config {
constexpr unsigned RATE = ${pin.sampleRate};
constexpr unsigned FRAMES_PER_SECOND = ${pin.framesPerSecond};
constexpr unsigned PHRASE_SECONDS = ${pin.phraseSeconds};
constexpr unsigned QUEUE_SECONDS = ${pin.queueSeconds};
constexpr unsigned WAV_SECONDS = ${pin.wavSeconds};
constexpr float SILENCE = ${pin.silenceThreshold}f;
constexpr unsigned THREADS = ${pin.recognizerThreads};
}
`,
  )
  const build = path.join(scratch, 'build')
  execFileSync(
    'cmake',
    [
      '-S',
      'native/dictation-linux',
      '-B',
      build,
      `-DWHISPER_SOURCE=${path.resolve(source)}`,
      '-DCMAKE_BUILD_TYPE=Release',
      `-DMUSE_CONFIG_DIR=${scratch}`,
    ],
    { stdio: 'inherit' },
  )
  execFileSync('cmake', ['--build', build, '--target', 'muse-dictate', '-j3'], { stdio: 'inherit' })
  const directory = path.join('native/linux', process.arch)
  await mkdir(directory, { recursive: true })
  const files = await readdir(path.join(build, 'bin'))
  for (const file of files) {
    if (file !== 'muse-dictate' && !/^lib(?:ggml[^/]*|whisper)\.so(?:\.\d+)*$/.test(file)) continue
    const target = path.join(directory, file)
    // Copy library symlink contents: VSIX/CI ZIP artifacts do not preserve symlink modes.
    await copyFile(path.join(build, 'bin', file), target)
    execFileSync('strip', [target])
    await chmod(target, 0o755)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
