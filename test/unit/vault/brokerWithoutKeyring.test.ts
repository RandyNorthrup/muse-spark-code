import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { lstat, mkdir, mkdtemp } from 'node:fs/promises'
import { constants, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  awaitFixtureMessage,
  bundleFixtureChild,
  compileVaultPeer,
  shutdownFixtureChild,
  sweepFixtureChildren,
  trackFixtureChild,
} from '../helpers/vault/fixtureChildren'
import {
  VAULT_SOCKET_DIR_HASH_CHARS,
  VAULT_SOCKET_DIR_PREFIX,
  VAULT_SOCKET_FILE,
  VAULT_SOCKET_PATH_LIMIT_BYTES,
} from '../../../src/shared/constants'

// A staged package carries no node_modules, so the OS keyring binding is
// genuinely absent in this fixture: the broker must still start its
// channel (the OS-store tier degrades per operation), never refuse startup.
const fixture = { root: '', sockBase: '', unusable: '' }
const children = new Set<ChildProcess>()
// The socket base must verify owner-only and stay within the bind limit:
// the leaf the broker adds is fixed size, so a temporary root longer than
// the limit minus that leaf cannot fit the socket on this OS. macOS ignores
// XDG_RUNTIME_DIR, so TMPDIR is the base there; Linux prefers
// XDG_RUNTIME_DIR. No subdirectory is created: every extra character costs
// bind bytes, and the leaf already names this data folder uniquely.
let runtimeBase = process.env['XDG_RUNTIME_DIR'] ?? tmpdir()
try {
  // The vault refuses roots under a symlinked ancestor (macOS spells its
  // temporary root through /var, a symlink to /private/var): resolve to
  // the real path, or the broker's shutdown snapshot refuses at close.
  runtimeBase = realpathSync(runtimeBase)
} catch {
  /* The run-time owner-only check below skips when the base is unusable. */
}
const socketLength =
  Buffer.byteLength(runtimeBase, 'utf8') +
  1 +
  VAULT_SOCKET_DIR_PREFIX.length +
  VAULT_SOCKET_DIR_HASH_CHARS +
  1 +
  VAULT_SOCKET_FILE.length
// Collection-time skip with a reason (certification record): rigs whose
// temporary root cannot fit the socket would hang to the test timeout.
const hasSocketFit =
  socketLength <= VAULT_SOCKET_PATH_LIMIT_BYTES[process.platform === 'darwin' ? 'darwin' : 'other']
beforeAll(async () => {
  if (!hasSocketFit || process.platform === 'win32') return
  // The base must already exist owner-only; anything else makes the child
  // refuse, so the test skips at run time instead of failing the product.
  const owner = typeof process.getuid === 'function' ? process.getuid() : null
  try {
    const sample = await lstat(runtimeBase)
    if (
      owner === null ||
      !sample.isDirectory() ||
      sample.isSymbolicLink() ||
      sample.uid !== owner ||
      (sample.mode & constants.S_IRWXG) !== 0 ||
      (sample.mode & constants.S_IRWXO) !== 0 ||
      (sample.mode & constants.S_IRWXU) !== constants.S_IRWXU
    )
      fixture.unusable = `socket base is not owner-only: ${runtimeBase}`
  } catch {
    fixture.unusable = `socket base is missing: ${runtimeBase}`
  }
  if (fixture.unusable) return
  fixture.sockBase = runtimeBase
  // The install root carries the vault files, so it needs the real path
  // too: the shutdown snapshot walks every ancestor's identity.
  let installBase = tmpdir()
  try {
    installBase = realpathSync(installBase)
  } catch {
    fixture.unusable = `temporary root is missing: ${installBase}`
    return
  }
  fixture.root = await mkdtemp(path.join(installBase, 'vs-nokeyring-'))
  // The test proves nothing if the binding resolves from an ancestor
  // install: fail fast instead of passing against the real keyring.
  expect(() =>
    createRequire(path.join(fixture.root, 'dist', 'vaultBrokerNoKeyring.js')).resolve(
      '@napi-rs/keyring',
    ),
  ).toThrow()
  await compileVaultPeer(fixture.root)
  await mkdir(path.join(fixture.root, 'dist'))
  await bundleFixtureChild(
    'test/unit/helpers/vault/sessionBrokerNoKeyringChild.ts',
    path.join(fixture.root, 'dist', 'vaultBrokerNoKeyring.js'),
    { external: ['@napi-rs/keyring'], define: { 'require.main': 'undefined' } },
  )
})
afterAll(() => sweepFixtureChildren(children, fixture.root))
describe.skipIf(!hasSocketFit || process.platform === 'win32')(
  'vault broker without the OS keyring binding',
  () => {
    it('starts its channel where no keyring module is installed', async (context) => {
      if (fixture.unusable) context.skip()
      const dataDir = path.join(fixture.root, 'vault')
      const child = spawn(
        process.execPath,
        [
          path.join(fixture.root, 'dist', 'vaultBrokerNoKeyring.js'),
          JSON.stringify({
            dataDir,
            runDirectory: path.join(dataDir, 'run'),
            installRoot: fixture.root,
            userSession: 'test',
          }),
        ],
        // Hermetic like the crash children: the install root carries no
        // node_modules and stands clear of every ancestor install, so the
        // keyring import genuinely fails here. The socket base is the
        // lane's short runtime directory (TMPDIR on macOS, XDG on Linux).
        {
          env: {
            HOME: fixture.root,
            TMPDIR: fixture.sockBase,
            XDG_RUNTIME_DIR: fixture.sockBase,
          },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      )
      const errors = trackFixtureChild(children, child)
      // A crashed child must fail fast with its diagnostics, never hang to
      // the test timeout: readiness and early exit race each other.
      const ready = await awaitFixtureMessage(child, errors)
      if ('diagnostics' in ready)
        throw new Error(`broker child exited before ready: ${ready.diagnostics}`)
      expect(ready.message[0]).toEqual({ ready: true })
      // Ready is sent only after the fixture connected to the broker
      // socket and the in-process OS-store refusal held, so a clean
      // shutdown is the remaining assertion.
      await shutdownFixtureChild(children, child)
    })
  },
)
