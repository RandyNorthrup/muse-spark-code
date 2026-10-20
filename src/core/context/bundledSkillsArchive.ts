// Reads of the vendored skill package through its solid archive (VSIXWEB
// B): the packaged install carries `vendor/high-quality-projects-skill`
// as `vendor/high-quality-projects-skill.json.br` (LICENSE and VENDOR.json
// stay loose beside it); the source tree keeps the loose members and no
// archive. `withBundledSkillsArchive` wraps the skill loader's file system
// so the loader reads the same bytes either way: archived members come
// from the archive with every member's SHA-256 checked, anything else
// falls through to the loose files. A missing archive reads exactly as the
// loose tree; a damaged archive refuses its members exactly as unreadable
// files do (a shaped store failure the catalog turns into a warning, never
// a failed turn), and unverified bytes are never served.
import path from 'node:path'
import {
  parseSolidTextArchive,
  solidMemberBytes,
  type SolidTextFiles,
} from '../archives/solidTextArchive'
import { isCodedError } from '../workspaceRoot'
import {
  BUNDLED_SKILLS_ARCHIVE_FILE,
  BUNDLED_SKILLS_ARCHIVE_MAX_BYTES,
  BUNDLED_SKILLS_ARCHIVE_MEMBER_MAX_BYTES,
  BUNDLED_SKILLS_ARCHIVE_VERSION,
} from '../../shared/constants'
import { contentHash } from '../schedules/provenance'
import type { ContextIo, ContextSourceRead } from './contextFiles'

/** The archive's refusal as the catalog reads it: a shaped store failure carrying its cause. */
function archiveReadFailure(cause: unknown): Error {
  return Object.assign(new Error('Bundled skills archive cannot be read', { cause }), {
    code: 'bundled-skills-archive-unreadable',
  })
}

/**
The skill loader's file system with the vendored package served from its
solid archive when the install is packaged. Every other path, and the
whole loose tree when no archive sits beside the package, reads through
`base` unchanged.
*/
export function withBundledSkillsArchive(
  base: ContextIo,
  vendorRoot: string | undefined,
  platform: NodeJS.Platform,
): ContextIo {
  if (vendorRoot === undefined) return base
  const pathModule = platform === 'win32' ? path.win32 : path.posix
  const archive = pathModule.join(pathModule.dirname(vendorRoot), BUNDLED_SKILLS_ARCHIVE_FILE)

  /**
  The root in its canonical spelling, resolved once: an ancestor of the
  root itself spelled through a symlink (`/var` on macOS, a short name on
  Windows) is not a link inside the tree, so the link check must compare
  against this spelling, not the spelled root. A file system that refuses
  to say keeps the spelled root; the reads then fail as they do today.
  */
  let canonicalRoot: string | undefined
  const rootCanonical = async (): Promise<string> => {
    if (canonicalRoot === undefined) {
      try {
        canonicalRoot = await base.realPath(vendorRoot)
      } catch (error: unknown) {
        // Only a shaped store failure keeps the spelled root: anything
        // else keeps its kind past the archive.
        if (!isCodedError(error)) throw error
        canonicalRoot = vendorRoot
      }
    }
    return canonicalRoot
  }

  /** The vendor-relative posix path below `root`, or undefined past it. */
  const relativeTo = (root: string, absolutePath: string): string | undefined => {
    const local = pathModule.relative(root, absolutePath)
    return local === '' ||
      local === '..' ||
      local.startsWith(`..${pathModule.sep}`) ||
      pathModule.isAbsolute(local)
      ? undefined
      : local.split(pathModule.sep).join('/')
  }

  /** The vendor-relative posix path, or undefined past the package root. */
  const relative = (absolutePath: string): string | undefined =>
    relativeTo(vendorRoot, absolutePath)

  /**
  The vendor-relative posix path under either spelling of the root: the
  caller names the spelled install path, while a path past the link check
  carries the canonical one.
  */
  const relativeEither = async (absolutePath: string): Promise<string | undefined> =>
    relative(absolutePath) ?? relativeTo(await rootCanonical(), absolutePath)

  /** The archive's validated members; undefined beside a loose tree. */
  const archived = async (): Promise<SolidTextFiles | undefined> => {
    const packed = await base.readFile(archive, BUNDLED_SKILLS_ARCHIVE_MAX_BYTES)
    if (packed === undefined) return undefined
    try {
      return parseSolidTextArchive(
        packed,
        BUNDLED_SKILLS_ARCHIVE_MAX_BYTES,
        BUNDLED_SKILLS_ARCHIVE_VERSION,
      )
    } catch (error: unknown) {
      if (isCodedError(error)) throw error
      throw archiveReadFailure(error)
    }
  }

  /** One archived member's verified bytes; undefined when the loose files serve it. */
  const memberBytes = async (name: string): Promise<Uint8Array | undefined> => {
    const files = await archived()
    if (files === undefined) return undefined
    const entry = files[name]
    if (entry === undefined) return undefined
    try {
      const bytes = solidMemberBytes(entry, name)
      if (bytes.byteLength > BUNDLED_SKILLS_ARCHIVE_MEMBER_MAX_BYTES)
        throw new Error(`Bundled skill member is over its bound: ${name}`)
      return bytes
    } catch (error: unknown) {
      if (isCodedError(error)) throw error
      throw archiveReadFailure(error)
    }
  }

  /** The archive-implied subdirectories of a vendor directory, by posix prefix. */
  const archivedDirs = (files: SolidTextFiles, prefix: string): readonly string[] => {
    const names = new Set<string>()
    const scope = prefix === '' ? '' : `${prefix}/`
    for (const name of Object.keys(files)) {
      if (!name.startsWith(scope)) continue
      // A member directly in the directory is a file, never a listing
      // entry: only a deeper remainder names a subdirectory, as the loose
      // listing's directory-and-link filter does.
      const rest = name.slice(scope.length)
      if (!rest.includes('/')) continue
      const head = rest.split('/', 2)[0]
      if (head !== undefined && head !== '') names.add(head)
    }
    return [...names].toSorted((left, right) => left.localeCompare(right, 'en'))
  }

  const overlay: ContextIo = {
    ...(base.readSource !== undefined && {
      readSource: async (
        absolutePath: string,
        maxBytes?: number,
      ): Promise<ContextSourceRead | undefined> => {
        if ((await relativeEither(absolutePath)) === undefined)
          return await base.readSource?.(absolutePath, maxBytes)
        const bytes = await overlay.readFile(absolutePath, maxBytes)
        if (bytes === undefined) return undefined
        return {
          bytes,
          source: {
            kind: 'file',
            contentHash: contentHash(bytes),
            file: {
              path: absolutePath.replaceAll('\\', '/'),
              dev: '0',
              ino: '0',
              size: bytes.length,
              mtime: '0',
            },
          },
        }
      },
    }),
    readFile: async (absolutePath: string, maxBytes?: number): Promise<Uint8Array | undefined> => {
      const name = await relativeEither(absolutePath)
      if (name === undefined) return await base.readFile(absolutePath, maxBytes)
      const bytes = await memberBytes(name)
      // An archived member the loose tree holds instead (LICENSE,
      // VENDOR.json) falls through; a file over the catalog's cap reads
      // whole, and the catalog refuses it by its length, as a loose read past
      // the cap does.
      return bytes ?? (await base.readFile(absolutePath, maxBytes))
    },
    listDirectory: async (absolutePath: string): Promise<readonly string[]> => {
      if ((await relativeEither(absolutePath)) === undefined)
        return await base.listDirectory(absolutePath)
      const files = await archived()
      if (files === undefined) return await base.listDirectory(absolutePath)
      // The loose directory is absent in a packaged install: its listing
      // failure reads as no loose entries, and the archive names the rest.
      let loose: readonly string[]
      try {
        loose = await base.listDirectory(absolutePath)
      } catch (error: unknown) {
        if (!isCodedError(error)) throw error
        loose = []
      }
      const prefix = (await relativeEither(absolutePath)) ?? ''
      return [...new Set([...loose, ...archivedDirs(files, prefix)])].toSorted((left, right) =>
        left.localeCompare(right, 'en'),
      )
    },
    realPath: async (absolutePath: string): Promise<string> => {
      // A vendor path canonicalises through the file system like any other
      // path, so the link check compares the canonical target with the
      // canonical root: a symlinked or short-named ancestor of the root
      // itself then stays inside it. Archive members absent from the loose
      // tree resolve through their nearest existing ancestor, while a link
      // inside the tree that leads outside it still resolves outside it
      // and is refused exactly as today.
      return await base.realPath(absolutePath)
    },
  }
  return overlay
}
