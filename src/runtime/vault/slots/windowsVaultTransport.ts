import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import { windowsVaultRequestSchema, type WindowsVaultTransport } from './windowsVaultProtocol'

const INTEGRITY_REFUSED_EXIT = 23

/** The compiler supplies the digest; it never comes from the mutable cache. */
export interface WindowsVaultExecutable {
  readonly file: string
  readonly sha256: string
  readonly powershell: string
  readonly guardSource: string
  readonly rebuild: () => Promise<void>
  readonly report: () => void
}

/** Trusted inline script, executed only by the absolute system PowerShell. */
export function windowsVaultGuardScript(file: string, digest?: string): string {
  const quoted = `'${file.replaceAll("'", "''")}'`
  return `
$ErrorActionPreference = 'Stop'
$target = ${quoted}
try {
  # Only packaged public source precedes readiness; private input follows verification.
  $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8, $false, 1, $true)
  try { $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($reader.ReadLine())) } finally { $reader.Dispose() }
  $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
  $parameters = New-Object CodeDom.Compiler.CompilerParameters
  $parameters.GenerateInMemory = $true
  [void]$parameters.ReferencedAssemblies.Add('System.dll')
  [void]$parameters.ReferencedAssemblies.Add('System.Core.dll')
  try { $compiled = $provider.CompileAssemblyFromSource($parameters, [string[]]@($source)) } finally { $provider.Dispose() }
  if ($compiled.Errors.HasErrors) { throw 'refused' }
  $guard = $compiled.CompiledAssembly.GetType('MuseSparkVaultNative.VaultPathGuard', $true)
  ${
    digest === undefined
      ? `$guard.GetMethod('Prepare').Invoke($null, [object[]]@($target))`
      : `$result = $guard.GetMethod('Launch').Invoke($null, [object[]]@($target, '${digest}'))
  exit ([int]$result)`
  }
} catch { exit ${String(INTEGRITY_REFUSED_EXIT)} }
`
}

/** One private helper per use; screen-lock waits last until the broker cancels. */
export function windowsVaultTransport(
  helper: WindowsVaultExecutable,
  signal?: AbortSignal,
): WindowsVaultTransport {
  if (
    !path.isAbsolute(helper.file) ||
    !helper.file.toLowerCase().endsWith('.exe') ||
    !path.isAbsolute(helper.powershell) ||
    !/^[a-f0-9]{64}$/u.test(helper.sha256)
  )
    throw new Error(UI_TEXT.vault.noAccess)
  return {
    exchange: (header, key) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted || header.length > VAULT_LIMITS.text) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        let request: unknown
        try {
          request = JSON.parse(Buffer.from(header).toString('utf8'))
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const parsed = windowsVaultRequestSchema.safeParse(request)
        if (
          !parsed.success ||
          key.length !== (parsed.data.operation === 'wrap' ? VAULT_KEY_BYTES : 0)
        ) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        // Do not inherit credentials, a shell, or a visible console window.
        let child: ChildProcessWithoutNullStreams
        try {
          child = spawn(
            helper.powershell,
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(windowsVaultGuardScript(helper.file, helper.sha256), 'utf16le').toString(
                'base64',
              ),
            ],
            {
              cwd: path.dirname(helper.powershell),
              env: {},
              stdio: 'pipe',
              shell: false,
              windowsHide: true,
            },
          )
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let isSettled = false
        let isReady = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (isOk: boolean) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          if (isOk) {
            const output = Buffer.alloc(size)
            let offset = 0
            for (const chunk of chunks) {
              output.set(chunk, offset)
              offset += chunk.length
            }
            resolve(output)
          } else {
            child.kill('SIGKILL')
            reject(new Error(UI_TEXT.vault.noAccess))
          }
          for (const chunk of chunks) chunk.fill(0)
        }
        const abort = () => {
          finish(false)
        }
        if (parsed.data.operation !== 'screenLock') timer = setTimeout(abort, VAULT_APPROVAL_TTL_MS)
        signal?.addEventListener('abort', abort, { once: true })
        child.on('error', abort)
        child.stdin.on('error', abort)
        child.stdout.on('data', (chunk: Buffer) => {
          if (isSettled) {
            chunk.fill(0)
            return
          }
          if (!isReady) {
            if (chunk[0] !== 1) {
              chunk.fill(0)
              finish(false)
              return
            }
            isReady = true
            const length = Buffer.alloc(Uint32Array.BYTES_PER_ELEMENT)
            length.writeUInt32BE(header.length)
            try {
              child.stdin.write(length)
              child.stdin.write(header)
              child.stdin.end(key)
            } catch {
              chunk.fill(0)
              finish(false)
              return
            }
            chunk[0] = 0
            chunk = chunk.subarray(1)
          }
          size += chunk.length
          if (size > VAULT_LIMITS.text + VAULT_KEY_BYTES + Uint32Array.BYTES_PER_ELEMENT) {
            chunk.fill(0)
            finish(false)
            return
          }
          chunks.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
          chunk.fill(0)
        })
        child.on('close', (code) => {
          if (code === INTEGRITY_REFUSED_EXIT && !isReady && !isSettled) {
            try {
              helper.report()
            } catch {
              // A diagnostic sink cannot prevent the rebuild or the explicit refusal.
            }
            let rebuilding: Promise<void>
            try {
              rebuilding = helper.rebuild()
            } catch {
              finish(false)
              return
            }
            void rebuilding
              .then(() => {
                finish(false)
              })
              .catch(() => {
                finish(false)
              })
          } else finish(code === 0 && isReady)
        })
        try {
          child.stdin.write(Buffer.from(helper.guardSource, 'utf8').toString('base64') + '\n')
        } catch {
          finish(false)
        }
        if (signal?.aborted) abort()
      }),
  }
}
