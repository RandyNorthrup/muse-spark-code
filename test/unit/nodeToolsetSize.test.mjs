import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'

const python = process.platform === 'win32' ? 'python' : 'python3'
const folders = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
function fixture(mode = 'valid') {
  const folder = mkdtempSync(path.join(tmpdir(), 'm110-b0-size-'))
  folders.push(folder)
  const file = path.join(folder, 'image.tar')
  // Python's independent standard tar/gzip writers supply the exported-image fixture.
  execFileSync(python, [
    '-c',
    String.raw`
import gzip,io,json,sys,tarfile
mode=sys.argv[2]
manifest=[{'Config':'config.json','Layers':['layer.tar']}]
config={'architecture':'riscv64' if mode=='architecture' else 'amd64'}
layer=b'toolset bytes' * 100
if mode=='path':manifest[0]['Layers']=['../layer.tar']
if mode=='windows':manifest[0]['Layers']=['layers\\layer.tar']
if mode=='layers':manifest[0]['Layers']=[]
if mode=='images':manifest.append(manifest[0])
if mode=='gzip':layer=gzip.compress(layer,mtime=0)
rows=[] if mode=='manifest' else [('manifest.json',json.dumps(manifest).encode())]
if mode!='config':rows.append(('config.json',json.dumps(config).encode()))
if mode!='layer':rows.append(('layers/layer.tar' if mode=='windows' else 'layer.tar',layer))
with tarfile.open(sys.argv[1], 'w') as archive:
 for name,data in rows:
  item=tarfile.TarInfo(name);item.size=len(data);archive.addfile(item,io.BytesIO(data))
 if mode=='manifest':
  item=tarfile.TarInfo('manifest.json');item.type=tarfile.DIRTYPE;archive.addfile(item)
 if mode in ('config','layer'):
  item=tarfile.TarInfo('config.json' if mode=='config' else 'layer.tar');item.type=tarfile.DIRTYPE;archive.addfile(item)
`,
    file,
    mode,
  ])
  return file
}

describe('compressed toolset image measurements', () => {
  it('reads docker-save layer metadata without executing or extracting it', () => {
    const output = execFileSync(python, ['scripts/measure-node-toolset.py', fixture(), 'base'], {
      encoding: 'utf8',
    })
    const result = JSON.parse(output)
    expect(result.architecture).toBe('amd64')
    expect(result.pack).toBe('base')
    expect(result.layers).toHaveLength(1)
    expect(result.compressedBytes).toBeGreaterThan(0)
    expect(result.compressedBytes).toBeLessThan(1200)
  })
  it.each(['gzip', 'windows'])('measures %s layers without extraction', (mode) => {
    const result = JSON.parse(
      execFileSync(python, ['scripts/measure-node-toolset.py', fixture(mode), 'base'], {
        encoding: 'utf8',
      }),
    )
    expect(result.compressedBytes).toBeGreaterThan(0)
    expect(result.compressedBytes).toBeLessThan(1200)
  })
  it.each([
    ['manifest', 'Missing image manifest'],
    ['architecture', 'Unsupported image architecture'],
    ['path', 'Unsafe image layer path'],
    ['layers', 'Missing image layers'],
    ['images', 'One image required'],
    ['config', 'Missing image config'],
    ['layer', 'Missing image layer'],
  ])('refuses %s image metadata', (mode, message) => {
    const result = spawnSync(python, ['scripts/measure-node-toolset.py', fixture(mode), 'base'], {
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })
  it.each(['base', 'build'])('rejects an over-budget %s receipt', (pack) => {
    const result = spawnSync(
      python,
      [
        '-c',
        `
import runpy
module=runpy.run_path('scripts/measure-node-toolset.py')
module['check_budget']({'compressedBytes':200000001}, '${pack}', {'buildCompressedBytes':200000000})
`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exceeds compressed budget')
  })
  it.each([
    ['unknown', 1, 'Unknown image pack'],
    ['build', -1, 'Invalid image budget'],
    ['build', true, 'Invalid image budget'],
  ])('refuses invalid pack/budget %s/%s', (pack, budget, message) => {
    const result = spawnSync(
      python,
      [
        '-c',
        `
import runpy,json
module=runpy.run_path('scripts/measure-node-toolset.py')
module['check_budget']({'compressedBytes':0}, '${pack}', {'buildCompressedBytes':json.loads('${JSON.stringify(budget)}')})
`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })
  it('does not let a supplied budget enlarge the existing base cap', () => {
    const result = spawnSync(
      python,
      [
        '-c',
        `
import runpy
module=runpy.run_path('scripts/measure-node-toolset.py')
module['check_budget']({'compressedBytes':200000001}, 'base', {'baseCompressedBytes':999999999,'buildCompressedBytes':999999999})
`,
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('exceeds compressed budget')
  })
})
