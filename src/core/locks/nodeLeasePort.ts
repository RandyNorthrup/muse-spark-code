// Node's file operations for a file lease (fileLease.ts): exclusive
// creates (flushed to disk when asked), hard links that fail while the name is taken,
// exact native ids, and an in-place note rewrite bound to the open file.

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
import { sameFile } from '../fs/fileIdentity'
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
  rewriteOwn: async (file, identity, content) => {
    let handle
    try {
      handle = await open(file, 'r+')
    } catch {
      return false
    }
    try {
      // The file opened is the one named: a replacement is never written.
      const opened = await handle.stat({ bigint: true })
      if (!sameFile(opened, identity)) {
        return false
      }
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
