import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTsLoader, plain, tick, deferred, projectRoot } from './helpers/load-ts.mjs'

const { Buffer, setTimeout, setImmediate } = globalThis
const load = createTsLoader()
const flowwall = load('src/shared/flowwall.ts')
const { detectMediaSignature: sig, isImageSignature } = load('src/shared/media-signature.ts')
const read = (path) => readFile(join(projectRoot, path), 'utf8')

test('embedded FlowWall page stays on FlowWall, sign-in providers and media downloads', () => {
  const { classifyFlowWallNavigation: nav, isFlowWallUrl } = flowwall
  assert.equal(nav('https://www.flowwall.ai/wallpaper/discover'), 'internal')
  assert.equal(nav('https://cdn.flowwall.ai/w/123'), 'internal')
  assert.equal(nav('https://flowwall.art/'), 'internal')
  assert.equal(nav('about:blank'), 'internal')
  assert.equal(nav('https://accounts.google.com/o/oauth2/auth?x=1'), 'auth')
  assert.equal(nav('https://github.com/login/oauth/authorize'), 'auth')
  assert.equal(nav('https://cdn.example.com/wallpapers/aurora.MP4?sig=abc'), 'media')
  assert.equal(nav('https://www.flowwall.ai/files/pack.zip'), 'media')
  assert.equal(nav('https://example.com/pricing'), 'external')
  assert.equal(nav('http://www.flowwall.ai/wallpaper'), 'external', 'plain http leaves the embedded view')
  assert.equal(nav('mailto:hi@flowwall.ai'), 'external')
  assert.equal(nav('file:///C:/Windows/system32'), 'blocked')
  assert.equal(nav('javascript:alert(1)'), 'blocked')
  assert.equal(nav('not a url'), 'blocked')
  assert.equal(nav('https://flowwall.ai.evil.com/'), 'external', 'look-alike hosts are not FlowWall')
  assert.equal(isFlowWallUrl('https://evilflowwall.ai/'), false)
  assert.equal(isFlowWallUrl('https://www.FlowWall.ai/x'), true)
})

test('downloads are classified as wallpapers by name, MIME type or URL; other files are left alone', () => {
  const { classifyFlowWallDownload: classify } = flowwall
  assert.deepEqual(plain(classify({ filename: 'Aurora.MP4' })), { kind: 'video', extension: '.mp4' })
  assert.deepEqual(plain(classify({ filename: 'download', mimeType: 'image/jpeg; charset=binary' })), { kind: 'image', extension: '.jpg' })
  assert.deepEqual(plain(classify({ filename: 'blob', url: 'https://cdn.flowwall.ai/a/b.webm?token=1' })), { kind: 'video', extension: '.webm' })
  assert.deepEqual(plain(classify({ filename: 'pack.zip' })), { kind: 'package', extension: '.zip' })
  assert.equal(classify({ filename: 'setup.exe', mimeType: 'application/octet-stream' }), null)
  assert.equal(classify({ filename: 'terms.pdf', mimeType: 'application/pdf' }), null)
})

test('file content decides what a download really is', () => {
  const { signatureMatchesKind: matches } = flowwall
  const bytes = (...parts) => Uint8Array.from(Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part)))))
  assert.equal(sig(bytes([0, 0, 0, 0x18], 'ftypmp42', [0, 0, 0, 0])), 'mp4')
  assert.equal(sig(bytes([0x1a, 0x45, 0xdf, 0xa3])), 'webm')
  assert.equal(sig(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(sig(bytes([0xff, 0xd8, 0xff, 0xe0])), 'jpeg')
  assert.equal(sig(bytes('GIF89a')), 'gif')
  assert.equal(sig(bytes('RIFF', [0, 0, 0, 0], 'WEBP')), 'webp')
  assert.equal(sig(bytes([0x50, 0x4b, 0x03, 0x04])), 'zip')
  assert.equal(sig(bytes('BM', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'bmp')
  assert.equal(sig(bytes('<!doctype html><html>')), null)
  assert.equal(isImageSignature('bmp'), true)
  assert.equal(isImageSignature('mp4'), false)
  assert.equal(matches('bmp', 'image'), false, 'BMP is fine for chat, not as a wallpaper')
  assert.equal(matches('png', 'image'), true)
  assert.equal(matches('mp4', 'image'), false)
  assert.equal(matches('zip', 'video'), false)
  assert.equal(matches(null, 'video'), false)
})

test('wallpaper names come from the detail page title, falling back to the file name', () => {
  const { cleanFlowWallTitle: title } = flowwall
  assert.equal(title('星空之下 | FlowWall AI', 'x.mp4'), '星空之下')
  assert.equal(title('Neon City - FlowWall', 'x.mp4'), 'Neon City')
  assert.equal(title('Curated AI Live Wallpapers & 4K Wallpapers | FlowWall AI', 'misty_forest_4k.jpg'), 'misty forest 4k')
  assert.equal(title('FlowWall AI', '%E6%B5%B7%E8%BE%B9.png'), '海边')
  assert.equal(title('', ''), 'FlowWall 壁纸')
  assert.equal(title('a'.repeat(100) + ' | FlowWall', '').length, 60)
})

test('signed CDN query strings do not defeat duplicate detection', () => {
  const { normalizeSourceUrl: normalize } = flowwall
  assert.equal(normalize('https://CDN.flowwall.ai/w/1.mp4?Expires=1&Signature=a'), normalize('https://cdn.flowwall.ai/w/1.mp4?Expires=2&Signature=b'))
  assert.notEqual(normalize('https://cdn.flowwall.ai/w/1.mp4'), normalize('https://cdn.flowwall.ai/w/2.mp4'))
})

test('lingyue:// links can open the library or ask to import https media, nothing else', () => {
  const { parseLingyueDeepLink: parse, FLOWWALL_HOME_URL } = flowwall
  assert.deepEqual(plain(parse('lingyue://wallpaper/open')), { action: 'open-library', pageUrl: FLOWWALL_HOME_URL })
  assert.deepEqual(plain(parse('lingyue://wallpaper/open?page=https%3A%2F%2Fwww.flowwall.ai%2Fwallpaper%2F42')),
    { action: 'open-library', pageUrl: 'https://www.flowwall.ai/wallpaper/42' })
  assert.deepEqual(plain(parse('lingyue://wallpaper/open?page=https%3A%2F%2Fevil.com%2F')), { action: 'open-library', pageUrl: FLOWWALL_HOME_URL },
    'a foreign page is never opened inside the app')
  const imported = plain(parse('lingyue://wallpaper/import?url=https%3A%2F%2Fcdn.flowwall.ai%2Fw%2F1.mp4&title=%E6%9E%81%E5%85%89&page=https%3A%2F%2Fwww.flowwall.ai%2Fwallpaper%2F1'))
  assert.deepEqual(imported, { action: 'import-wallpaper', mediaUrl: 'https://cdn.flowwall.ai/w/1.mp4', title: '极光', pageUrl: 'https://www.flowwall.ai/wallpaper/1', trustedHost: true })
  assert.equal(parse('lingyue://wallpaper/import?url=https%3A%2F%2Fexample.com%2Fa.png').trustedHost, false)
  assert.equal(parse('lingyue://wallpaper/import?url=http%3A%2F%2Fcdn.flowwall.ai%2Fa.png'), null, 'plain http media is refused')
  assert.equal(parse('lingyue://wallpaper/import?url=https%3A%2F%2Fcdn.flowwall.ai%2Fsetup.exe'), null, 'only wallpaper file types')
  assert.equal(parse('lingyue://wallpaper/import?url=file%3A%2F%2F%2Fetc%2Fpasswd'), null)
  assert.equal(parse('lingyue://settings/reset'), null)
  assert.equal(parse('https://www.flowwall.ai/'), null)
})

function serviceHarness(t, { library = [], listDelay } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'flowwall-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const saved = {}
  const sent = []
  const imports = []
  const dialogs = []
  let dialogResponse = 0
  let willDownload
  const items = []
  class FakeItem extends EventEmitter {
    constructor(url) {
      super()
      this.url = url
      this.state = 'progressing'
      this.received = 0
    }
    getURL() { return this.url }
    getFilename() { return this.url.split('/').pop().split('?')[0] }
    getMimeType() { return '' }
    getTotalBytes() { return 0 }
    getReceivedBytes() { return this.received }
    setSavePath(path) { this.path = path }
    getSavePath() { return this.path }
    getState() { return this.state }
    cancel() {
      if (this.state !== 'progressing') return
      this.state = 'cancelled'
      setImmediate(() => this.emit('done', {}, 'cancelled'))
    }
    finish(content) {
      writeFileSync(this.path, content)
      this.received = content.length
      this.state = 'completed'
      this.emit('done', {}, 'completed')
    }
  }
  const fakeSession = {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    on(event, listener) { if (event === 'will-download') willDownload = listener },
    downloadURL(url) {
      const item = new FakeItem(url)
      items.push(item)
      willDownload({}, item, undefined)
    },
  }
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, payload) => sent.push({ channel, payload: plain(payload) }) } }
  const service = createTsLoader({
    mocks: {
      electron: {
        app: { isPackaged: true, getPath: () => root },
        session: { fromPartition: () => fakeSession },
        dialog: { showMessageBox: async (_win, options) => { dialogs.push(plain(options)); return { response: dialogResponse } } },
        shell: { openExternal: async () => undefined },
        WebContentsView: class {},
        BrowserWindow: class {},
      },
      '../store': { store: { get: (key) => saved[key], set: (key, value) => { saved[key] = plain(value) } } },
      '../runtime/userDataPaths': {
        getWallpaperDownloadsRoot: () => join(root, 'wallpaper-downloads'),
        sanitizeUserDataSegment: (value, fallback) => value || fallback,
      },
      '../ipc/wallpaperIpc': {
        listWallpapersForTool: async () => {
          if (listDelay) await listDelay()
          return library
        },
        importWallpaperFile: async (filePath, meta) => {
          imports.push({ filePath, existed: existsSync(filePath), meta: plain(meta) })
          const item = { id: `wp-${imports.length}` }
          library.push(item)
          return { ok: true, item }
        },
      },
    },
  })('src/main/services/flowwall-library.ts')
  const states = () => sent.filter((entry) => entry.channel === 'flowwall:download-changed').map((entry) => entry.payload.state)
  const lastDownload = () => sent.filter((entry) => entry.channel === 'flowwall:download-changed').at(-1)?.payload
  const until = async (predicate) => {
    // Real file I/O runs on the thread pool, so wait on the clock, not on ticks.
    for (let i = 0; i < 300 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(predicate(), `condition never became true: ${JSON.stringify(sent.map((entry) => entry.payload.state ?? entry.channel))}`)
  }
  const importLink = (url, title = '极光之夜') => service.handleLingyueDeepLink({
    action: 'import-wallpaper', mediaUrl: url, title, pageUrl: 'https://www.flowwall.ai/wallpaper/aurora', trustedHost: true,
  }, win)
  return { service, root, saved, sent, imports, dialogs, items, states, lastDownload, until, importLink, setDialogResponse: (value) => { dialogResponse = value } }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])

test('a confirmed download is checked by content, renamed to its real type and imported with its source', async (t) => {
  const h = serviceHarness(t)
  await h.importLink('https://cdn.flowwall.ai/w/aurora.jpg?sig=1')
  assert.equal(h.dialogs.length, 1)
  assert.match(h.dialogs[0].detail, /cdn\.flowwall\.ai（FlowWall）/)
  h.items[0].finish(PNG)
  await h.until(() => h.lastDownload()?.state === 'completed')
  assert.equal(h.imports.length, 1)
  assert.equal(h.imports[0].existed, true)
  assert.match(h.imports[0].filePath, /aurora\.png$/, 'a PNG served as .jpg is imported as .png')
  assert.equal(h.imports[0].meta.name, '极光之夜')
  assert.deepEqual({ ...h.imports[0].meta.extra, DownloadedAt: undefined }, {
    Source: 'flowwall', SourceUrl: 'https://cdn.flowwall.ai/w/aurora.jpg', PageUrl: 'https://www.flowwall.ai/wallpaper/aurora', DownloadedAt: undefined,
  })
  assert.equal(h.lastDownload().wallpaperId, 'wp-1')
  assert.deepEqual(readdirSync(join(h.root, 'wallpaper-downloads')), [], 'the temporary download folder is removed')
  assert.equal(h.saved.flowwallDownloads[0].state, 'completed')
})

test('a file whose content is not media is rejected and never imported', async (t) => {
  const h = serviceHarness(t)
  await h.importLink('https://cdn.flowwall.ai/w/fake.mp4')
  h.items[0].finish(Buffer.from('<!doctype html><title>login</title>'))
  await h.until(() => h.lastDownload()?.state === 'failed')
  assert.equal(h.imports.length, 0)
  assert.match(h.lastDownload().error, /不是有效的视频或图片/)
})

test('re-downloading a wallpaper that is still in the library is reported as a duplicate, even when the file finishes first', async (t) => {
  const gate = deferred()
  let delay
  const h = serviceHarness(t, { listDelay: () => delay?.() })
  await h.importLink('https://cdn.flowwall.ai/w/aurora.png?sig=1')
  h.items[0].finish(PNG)
  await h.until(() => h.lastDownload()?.state === 'completed')

  // The library lookup is still pending when the tiny file completes.
  delay = () => gate.promise
  await h.importLink('https://cdn.flowwall.ai/w/aurora.png?sig=2')
  h.items[1].finish(PNG)
  await tick()
  gate.resolve()
  await h.until(() => h.lastDownload()?.state === 'duplicate')
  assert.equal(h.imports.length, 1, 'no second copy in the library')
  assert.equal(h.lastDownload().wallpaperId, 'wp-1')
})

test('an in-progress re-download is cancelled as soon as the duplicate is known', async (t) => {
  const h = serviceHarness(t)
  await h.importLink('https://cdn.flowwall.ai/w/aurora.png')
  h.items[0].finish(PNG)
  await h.until(() => h.lastDownload()?.state === 'completed')
  await h.importLink('https://cdn.flowwall.ai/w/aurora.png')
  await h.until(() => h.items[1].state === 'cancelled')
  await h.until(() => h.lastDownload()?.state === 'duplicate')
  assert.equal(h.imports.length, 1)
})

test('declining the import prompt downloads nothing', async (t) => {
  const h = serviceHarness(t)
  h.setDialogResponse(1)
  await h.importLink('https://example.com/a.png')
  assert.equal(h.items.length, 0)
  assert.equal(h.sent.length, 0)
})

test('FlowWall view isolation, IPC roles and protocol registration stay locked down', async () => {
  const service = await read('src/main/services/flowwall-library.ts')
  const ipc = await read('src/main/ipc/flowwallIpc.ts')
  const main = await read('src/main/index.ts')
  const builder = await read('electron-builder.yml')
  const wallpaperIpc = await read('src/main/ipc/wallpaperIpc.ts')
  assert.match(wallpaperIpc, /importWallpaperFile\(filePath, \{ name: meta\.name, desc: meta\.desc, author: meta\.author, contact: meta\.contact \}\)/,
    'a renderer import cannot claim to come from FlowWall')
  const viewOptions = service.slice(service.indexOf('new WebContentsView('), service.indexOf('view.setBackgroundColor'))
  assert.match(viewOptions, /partition: FLOWWALL_PARTITION/)
  assert.match(viewOptions, /sandbox: true/)
  assert.match(viewOptions, /contextIsolation: true/)
  assert.match(viewOptions, /nodeIntegration: false/)
  assert.doesNotMatch(viewOptions, /preload/, 'the web page gets no bridge into the app')
  assert.match(service, /setPermissionRequestHandler/)
  assert.match(service, /!app\.isPackaged && override/, 'the local test site override is development-only')
  assert.equal((ipc.match(/ipcMain\.(handle|on)\(/g) ?? []).length, (ipc.match(/assertTrustedIpcSender\(event, \['main'\]\)/g) ?? []).length)
  assert.match(main, /if \(app\.isPackaged\) app\.setAsDefaultProtocolClient\(LINGYUE_PROTOCOL\)/)
  assert.match(builder, /schemes:\s*\n\s*- lingyue/)
})
