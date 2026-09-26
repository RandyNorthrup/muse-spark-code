// Where Muse Code keeps its memory (M49, PLAN.md D41). Found on disk on
// 2026-09-25 and confirmed by a live capture with the data home moved:
//
//   personal          $XDG_DATA_HOME/muse/memory/personal
//   personal_project  $XDG_DATA_HOME/muse/memory/projects/<slug>-<key>
//   project           <workspace>/.agents/memory
//
// with `~/.local/share` when XDG_DATA_HOME is unset (Windows included). The
// project folder's `<key>` is the FNV-1a 64-bit hash of the workspace's
// canonical path as Rust spells it (`\\?\C:\…` on Windows), in 16 hex digits,
// and `<slug>` its readable half: ASCII letters, digits and hyphens kept,
// anything else a hyphen, the ends trimmed (`C:\muse-live-m49\My Proj.v2_x+é`
// is `C--muse-live-m49-My-Proj-v2-x-0175e6b82ee81b32`). Both were checked
// against the two folders Muse Code made. Pure.

import path from 'node:path'
import {
  MEMORY_DATA_HOME_SEGMENTS,
  MEMORY_DATA_SEGMENTS,
  MEMORY_PERSONAL_DIR,
  MEMORY_PROJECTS_DIR,
} from '../../shared/constants'

export interface MemoryHomeInput {
  readonly platform: NodeJS.Platform
  /** Undefined when the host has no home folder. */
  readonly homeDir: string | undefined
  /** `XDG_DATA_HOME` as `muse serve` sees it (PLAN.md D41). */
  readonly xdgDataHome: string | undefined
}

// FNV-1a, 64 bits: the offset basis and the prime.
const FNV_OFFSET_BASIS = 0xcb_f2_9c_e4_84_22_23_25n
const FNV_PRIME = 0x1_00_00_00_01_b3n
const UINT64_MASK = 0xff_ff_ff_ff_ff_ff_ff_ffn
const HEX_RADIX = 16
const KEY_DIGITS = 16
// Rust's canonical Windows paths are verbatim: `\\?\C:\…`, `\\?\UNC\server\…`.
const VERBATIM_PREFIX = '\\\\?\\'
const VERBATIM_UNC_PREFIX = '\\\\?\\UNC\\'
const UNC_PREFIX = String.raw`\\`
const SLUG_REPLACED = /[^A-Za-z0-9-]/g
const SLUG_ENDS = /^-+|-+$/g
const HYPHEN = '-'

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Muse Code's memory data root, `…/muse/memory`; undefined without a home or a data home. */
export function memoryDataRoot(input: MemoryHomeInput): string | undefined {
  const p = pathModule(input.platform)
  if (input.xdgDataHome !== undefined && input.xdgDataHome !== '') {
    return p.join(input.xdgDataHome, ...MEMORY_DATA_SEGMENTS)
  }
  return input.homeDir === undefined
    ? undefined
    : p.join(input.homeDir, ...MEMORY_DATA_HOME_SEGMENTS, ...MEMORY_DATA_SEGMENTS)
}

export function personalMemoryRoot(dataRoot: string, platform: NodeJS.Platform): string {
  return pathModule(platform).join(dataRoot, MEMORY_PERSONAL_DIR)
}

export function projectsMemoryRoot(dataRoot: string, platform: NodeJS.Platform): string {
  return pathModule(platform).join(dataRoot, MEMORY_PROJECTS_DIR)
}

/** The path as Rust's `canonicalize` gives it on this platform. */
function rustCanonical(canonicalRoot: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32' || canonicalRoot.startsWith(VERBATIM_PREFIX)) {
    return canonicalRoot
  }
  return canonicalRoot.startsWith(UNC_PREFIX)
    ? `${VERBATIM_UNC_PREFIX}${canonicalRoot.slice(UNC_PREFIX.length)}`
    : `${VERBATIM_PREFIX}${canonicalRoot}`
}

function fnv1a64(bytes: Uint8Array): string {
  let hash = FNV_OFFSET_BASIS
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & UINT64_MASK
  }
  return hash.toString(HEX_RADIX).padStart(KEY_DIGITS, '0')
}

/** The hash half of the project folder's name, from the workspace's canonical path. */
export function projectMemoryKey(canonicalRoot: string, platform: NodeJS.Platform): string {
  return fnv1a64(new TextEncoder().encode(rustCanonical(canonicalRoot, platform)))
}

/** The readable half of the project folder's name. */
export function projectMemorySlug(canonicalRoot: string): string {
  return canonicalRoot.replaceAll(SLUG_REPLACED, '-').replaceAll(SLUG_ENDS, '')
}

/**
 * The workspace's folder under `projects`: one that already ends in its key
 * (whatever Muse Code named it), else the name Muse Code would give it.
 */
export function projectMemoryFolder(
  existing: readonly string[],
  canonicalRoot: string,
  platform: NodeJS.Platform,
): string {
  const key = projectMemoryKey(canonicalRoot, platform)
  const suffix = `${HYPHEN}${key}`
  const found = existing
    .filter((name) => name.endsWith(suffix))
    .toSorted((a, b) => a.localeCompare(b))[0]
  return found ?? `${projectMemorySlug(canonicalRoot)}${suffix}`
}
