import { statSync } from 'node:fs'

/** Probe the actual administrative share; never create a share or change permissions. */
export function adminShare(file: string, host = 'localhost'): string | undefined {
  const root = `\\\\${host}\\${file.charAt(0)}$`
  try {
    statSync(root)
    return `${root}${file.slice(2)}`
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown'
    console.warn(`SECWINPATH2: ${root} unavailable (${code}); skipping administrative-share test`)
    return undefined
  }
}
