// Node's file operations for a file lease (fileLease.ts): exclusive
// creates (flushed to disk when asked), hard links that fail while the name is taken,
// exact native ids, and an in-place note rewrite of the very file opened.

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import type { LeasePort } from './fileLease'

export const nodeLeasePort: LeasePort = {
  mkdir: async (folder) => {
    await mkdir(folder, { recursive: true })
  },
  readdir: (folder) => readdir(folder),
  readFile: (file) => readFile(file),
  createExclusive: (file, content, durability) =>
    writeFile(file, content, { flag: 'wx', flush: durability === 'flushed' }),
  link: (existing, target) => link(existing, target),
  rename: (from, to) => rename(from, to),
  unlink: (file) => unlink(file),
  lstat: (file) => lstat(file, { bigint: true }),
  rewriteOwn: async (file, isOwn, content) => {
    let handle
    try {
      handle = await open(file, 'r+')
    } catch {
      return false
    }
    try {
      // Judged on the opened file itself, its stats and its content: a
      // replacement at the name is never written, whatever its file id.
      const opened = await handle.stat({ bigint: true })
      const current = await handle.readFile()
      if (!isOwn(opened, current)) {
        return false
      }
      // Acceptance begins the holder's pending rewrite. Its synchronous
      // view may recognize this file while truncate/write leaves a torn
      // note; settling this call ends that allowance, including on error.
      await handle.truncate(0)
      // Visible to other processes at once; a lease need not outlive a crash.
      await handle.write(content, 0, 'utf8')
      return true
    } finally {
      await handle.close()
    }
  },
  readdirSync: (folder) => readdirSync(folder),
  readFileSync: (file) => readFileSync(file),
  lstatSync: (file) => lstatSync(file, { bigint: true }),
}
