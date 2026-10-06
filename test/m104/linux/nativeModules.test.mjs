import assert from 'node:assert/strict'
import { Buffer, Blob } from 'node:buffer'
import { createHash, webcrypto } from 'node:crypto'
import { readFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { TextEncoder } from 'node:util'
import { setTimeout } from 'node:timers'
import { checkNativeBundleSize } from '../../../hosts/jetbrains/check-bundle-size.mjs'

const source = await readFile(
  new URL('../../../hosts/jetbrains/src/main/resources/nativeModules.mjs', import.meta.url),
  'utf8',
)
const main = '/assets/portable/main.js'
function moduleRecord(name, text, imports = []) {
  return {
    path: name,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    imports,
  }
}
function setup(addEventListener = (...args) => args) {
  const context = vm.createContext({
    TextEncoder,
    crypto: webcrypto,
    Blob,
    URL,
    addEventListener,
  })
  vm.runInContext(source, context)
  return context.installMuseModules
}

test('native loader refuses unlisted modules, duplicate records and changed bytes', async () => {
  const install = setup()
  await assert.rejects(
    install({ modules: [] }, () => assert.fail('Unlisted asset reached bridge')),
    /MHP_MODULE_UNLISTED/u,
  )
  const entry = moduleRecord(main, 'export {}')
  assert.throws(
    () => install({ modules: [entry, entry] }, () => assert.fail('Duplicate reached bridge')),
    /MHP_MODULE_DUPLICATE/u,
  )
  await assert.rejects(
    install({ modules: [entry] }, (_name, done) => done('changed')),
    /MHP_MODULE_CHANGED/u,
  )
})

test('native loader refuses dependency cycles and cannot finish after page teardown', async () => {
  const text = 'import "./main.js"'
  const entry = moduleRecord(main, text, [
    { start: 7, end: text.length, text: '"./main.js"', target: main, dynamic: false },
  ])
  await assert.rejects(
    Promise.race([
      setup()({ modules: [entry] }, (_name, done) => done(text)),
      new Promise((_resolve, reject) => {
        // A missing cycle guard deadlocks the graph; make that failure observable.
        setTimeout(() => reject(new Error('Loader cycle deadlocked')), 1000)
      }),
    ]),
    /MHP_MODULE_CYCLE/u,
  )
  let close
  const install = setup((_type, callback) => {
    close = callback
  })
  const pending = install({ modules: [moduleRecord(main, 'export {}')] }, (_name, done) => {
    done('export {}')
    close()
  })
  await assert.rejects(pending, /MHP_MODULE_CLOSED/u)
})

test('native loader validates import offsets and never requests a deferred module at startup', async () => {
  const install = setup()
  const staticPath = '/assets/portable/chunks/static.js'
  const dynamicPath = '/assets/portable/chunks/deferred.js'
  const text = 'import "./static.js"; import("./deferred.js");'
  const staticText = '"./static.js"'
  const dynamicText = 'import("./deferred.js")'
  const seen = []
  const imports = [
    {
      start: text.indexOf(staticText),
      end: text.indexOf(staticText) + staticText.length,
      text: staticText,
      target: staticPath,
      dynamic: false,
    },
    {
      start: text.indexOf(dynamicText),
      end: text.indexOf(dynamicText) + dynamicText.length,
      text: dynamicText,
      target: dynamicPath,
      dynamic: true,
    },
  ]
  await assert.rejects(
    install(
      {
        modules: [
          moduleRecord(main, text, imports),
          moduleRecord(staticPath, 'export {}'),
          moduleRecord(dynamicPath, 'export {}'),
        ],
      },
      (name, done) => {
        seen.push(name)
        done(name === main ? text : 'corrupt static')
      },
    ),
    /MHP_MODULE_CHANGED/u,
  )
  assert.deepEqual(seen, [main, staticPath])
  const changed = moduleRecord(main, text, [{ ...imports[0], end: imports[0].end + 1 }])
  await assert.rejects(
    install({ modules: [changed] }, (_name, done) => done(text)),
    /MHP_MODULE_IMPORT_CHANGED/u,
  )
})

test('native startup budget counts actual static dependencies and refuses falsified manifest sizes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm104pe-native-'))
  const pages = path.join(directory, 'pages')
  const portable = path.join(directory, 'portable')
  try {
    await mkdir(pages)
    await mkdir(portable)
    await writeFile(path.join(pages, 'whatsNew.inline.js'), '')
    await writeFile(path.join(portable, 'main.js'), '')
    const entry = moduleRecord(main, '')
    await writeFile(path.join(portable, 'modules.json'), JSON.stringify({ modules: [entry] }))
    checkNativeBundleSize(pages, portable)
    await writeFile(path.join(portable, 'main.js'), 'changed')
    assert.throws(() => checkNativeBundleSize(pages, portable), /MHP_MODULE_CHANGED/u)
    await writeFile(path.join(portable, 'main.js'), Buffer.alloc(950 * 1024))
    await writeFile(
      path.join(portable, 'modules.json'),
      JSON.stringify({ modules: [{ ...entry, bytes: 950 * 1024 }] }),
    )
    assert.throws(() => checkNativeBundleSize(pages, portable), /OVER native main/u)
    const text = 'import "./chunks/static.js"'
    const dependency = '/assets/portable/chunks/static.js'
    await mkdir(path.join(portable, 'chunks'))
    await writeFile(path.join(portable, 'main.js'), text)
    await writeFile(path.join(portable, 'chunks/static.js'), Buffer.alloc(950 * 1024))
    const imported = {
      start: 7,
      end: text.length,
      text: '"./chunks/static.js"',
      target: dependency,
      dynamic: false,
    }
    const modules = [
      moduleRecord(main, text, [imported]),
      moduleRecord(dependency, Buffer.alloc(950 * 1024)),
    ]
    await writeFile(path.join(portable, 'modules.json'), JSON.stringify({ modules }))
    assert.throws(() => checkNativeBundleSize(pages, portable), /OVER native main/u)
    modules[0].imports[0].dynamic = true
    await writeFile(path.join(portable, 'modules.json'), JSON.stringify({ modules }))
    checkNativeBundleSize(pages, portable)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Exercise the native validator with the schema keywords in A's frozen export.
test('embedded validator honors nullable type arrays and array maximums', async () => {
  const embedded = await readFile(
    new URL('../../../hosts/jetbrains/src/main/resources/embedded.mjs', import.meta.url),
    'utf8',
  )
  const context = vm.createContext({ TextEncoder })
  vm.runInContext(embedded, context)
  assert.equal(vm.runInContext('matches({type:["string","null"]},null)', context), true)
  assert.equal(vm.runInContext('matches({type:["string","null"]},"text")', context), true)
  assert.equal(vm.runInContext('matches({type:["string","null"]},1)', context), false)
  assert.equal(vm.runInContext('matches({type:"array",maxItems:1},[1])', context), true)
  assert.equal(vm.runInContext('matches({type:"array",maxItems:1},[1,2])', context), false)
})
