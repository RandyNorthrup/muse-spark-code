// M110os OS7: the package-key check for the Chrome add-on. The install
// keyring must carry every pinned fingerprint; anything else refuses.
// Node builtins only, so the device and CI run it bare.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fingerprintsFromColons } from '../../lib/fingerprints.mjs'

function isExecutableFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** Resolve the gpg binary: the explicit path, else the first on PATH. */
export function findGpg(explicit) {
  if (explicit !== undefined && isExecutableFile(explicit)) return explicit
  if (explicit !== undefined) return
  const pathValue = process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : ['']
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = path.join(dir, `gpg${extension.toLowerCase()}`)
      if (isExecutableFile(candidate)) return candidate
    }
  }
}

// The keyring's copy inside the throwaway home.
const CANDIDATE_KEYRING = 'candidate-keyring'

/**
Import a keyring into a throwaway home and list its fingerprints. The
import's own exit status is ignored on purpose: gpg reports failure
when its agent cannot start even though the keys imported (seen in a
sandbox without socket support). The listing afterwards is the verdict:
no fingerprints means nothing usable imported. gpg runs inside the home
and is handed only names relative to it: a gpg built for MSYS (Git for
Windows) reads a Windows path such as `C:\Users\…` as a relative one and
fails, while every build reads a relative name the same way.
*/
export function listKeyringFingerprints({ keyringPath, gpgPath }) {
  if (!existsSync(keyringPath)) return { ok: false, error: `keyring not found: ${keyringPath}` }
  const home = mkdtempSync(path.join(tmpdir(), 'node-os-keyring-'))
  try {
    copyFileSync(keyringPath, path.join(home, CANDIDATE_KEYRING))
    spawnSync(gpgPath, ['--batch', '--homedir', '.', '--import', CANDIDATE_KEYRING], {
      cwd: home,
      encoding: 'utf8',
    })
    const listed = spawnSync(
      gpgPath,
      ['--batch', '--homedir', '.', '--list-keys', '--with-colons'],
      {
        cwd: home,
        encoding: 'utf8',
      },
    )
    if (listed.status !== 0) {
      return { ok: false, error: `keyring listing failed: ${(listed.stderr ?? '').trim()}` }
    }
    const fingerprints = fingerprintsFromColons(listed.stdout ?? '')
    return fingerprints.length === 0
      ? { ok: false, error: 'keyring import failed: no keys imported' }
      : { ok: true, fingerprints }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
