/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron acceptance entry. */
// The FlowWall library service in a real Electron main process, pointed at a local stand-in
// site: the embedded page is isolated, its own download buttons are captured, files are
// checked by content, renamed to their true type, imported once, and bad files are refused.
const { app, BrowserWindow, session } = require('electron')
const http = require('node:http')
const zlib = require('node:zlib')
const process = require('node:process')
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { console, setTimeout, clearTimeout, Buffer } = globalThis
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const watchdog = setTimeout(() => { console.error('FLOWWALL_TIMEOUT'); app.exit(1) }, 60000)
app.on('window-all-closed', () => {})

function png(width, height) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.from([0, ...Array(width * 3).fill(120)])))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const files = {
  // A PNG served under a .jpg name: trusted by content, stored as .png.
  '/files/aurora-night.jpg': ['image/jpeg', png(64, 36)],
  '/files/aurora-live.mp4': ['video/mp4', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(4), Buffer.from('mp42isom'), Buffer.alloc(2048)])],
  '/files/login-wall.mp4': ['video/mp4', Buffer.from('<!doctype html><title>请先登录</title>')],
}
const page = `<!doctype html><html><head><meta charset="utf-8"><title>极光之夜 | FlowWall AI</title></head><body>
<a id="png" href="/files/aurora-night.jpg?sig=1" download>4K</a>
<a id="png-again" href="/files/aurora-night.jpg?sig=2" download>4K again</a>
<a id="mp4" href="/files/aurora-live.mp4" download>live</a>
<a id="bad" href="/files/login-wall.mp4" download>bad</a></body></html>`

async function run() {
  const root = process.env.LINGYUE_SMOKE_ROOT
  assert.ok(root, 'Run through tests/electron/run-smoke.mjs for post-exit cleanup')
  app.setPath('userData', join(root, 'userData'))
  app.setPath('sessionData', join(root, 'sessionData'))
  const server = http.createServer((req, res) => {
    const file = files[req.url.split('?')[0]]
    if (file) {
      res.writeHead(200, { 'Content-Type': file[0], 'Content-Length': file[1].length })
      return res.end(file[1])
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(page)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  process.env.LINGYUE_FLOWWALL_HOME = `http://127.0.0.1:${server.address().port}/wallpaper/aurora`

  const { createTsLoader } = await import('../helpers/load-ts.mjs')
  const saved = {}
  const library = []
  const imports = []
  const service = createTsLoader({
    mocks: {
      '../store': { store: { get: (key) => saved[key], set: (key, value) => { saved[key] = JSON.parse(JSON.stringify(value)) } } },
      '../runtime/userDataPaths': {
        getWallpaperDownloadsRoot: () => join(root, 'downloads'),
        sanitizeUserDataSegment: (value, fallback) => value.replace(/[<>:"/\\|?*]/g, '_') || fallback,
      },
      '../ipc/wallpaperIpc': {
        listWallpapersForTool: async () => library,
        importWallpaperFile: async (filePath, meta) => {
          imports.push({ file: filePath.split(/[\\/]/).pop(), existed: existsSync(filePath), meta })
          const item = { id: `wp-${imports.length}` }
          library.push(item)
          return { ok: true, item }
        },
      },
    },
  })('src/main/services/flowwall-library.ts')
  await app.whenReady()

  const events = []
  const win = new BrowserWindow({ show: false, width: 1000, height: 700 })
  await win.loadURL('about:blank')
  win.webContents.send = (channel, payload) => { if (channel === 'flowwall:download-changed') events.push(JSON.parse(JSON.stringify(payload))) }
  service.attachFlowWallView(win, { x: 0, y: 60, width: 1000, height: 640 })
  assert.equal(win.contentView.children.length, 1)
  const guest = win.contentView.children[0].webContents
  for (let i = 0; i < 100 && (guest.isLoading() || !guest.getURL().includes('/wallpaper/aurora')); i++) await sleep(50)

  // Isolation: its own persistent partition, no Node, no app bridge, no extra permissions.
  assert.equal(guest.session, session.fromPartition('persist:flowwall'))
  const isolation = await guest.executeJavaScript(`({ require: typeof require, process: typeof process, lingyue: typeof window.lingyue })`)
  assert.deepEqual(isolation, { require: 'undefined', process: 'undefined', lingyue: 'undefined' })
  assert.equal(await guest.executeJavaScript('Notification.requestPermission()'), 'denied')
  await guest.executeJavaScript(`location.href = 'file:///etc/hosts'; true`).catch(() => undefined)
  await sleep(300)
  assert.match(guest.getURL(), /\/wallpaper\/aurora$/, 'local files cannot be opened in the view')

  const last = () => events.at(-1)
  const waitState = async (state, label) => {
    for (let i = 0; i < 200; i++) {
      if (last()?.state === state) return last()
      await sleep(50)
    }
    throw new Error(`Timed out: ${label} (last=${JSON.stringify(last())})`)
  }
  const click = (id) => guest.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click(); true`)

  await click('png')
  const image = await waitState('completed', 'image import')
  assert.equal(image.title, '极光之夜')
  assert.equal(imports[0].file, 'aurora-night.png')
  assert.equal(imports[0].existed, true)
  assert.equal(imports[0].meta.extra.Source, 'flowwall')
  assert.equal(imports[0].meta.extra.SourceUrl.endsWith('/files/aurora-night.jpg'), true, 'signed query strings are dropped')

  await click('png-again')
  const duplicate = await waitState('duplicate', 'duplicate download')
  assert.equal(duplicate.wallpaperId, 'wp-1')

  await click('bad')
  const bad = await waitState('failed', 'content check')
  assert.match(bad.error, /不是有效的视频或图片/)

  await click('mp4')
  await waitState('completed', 'video import')
  assert.deepEqual(imports.map((item) => item.file), ['aurora-night.png', 'aurora-live.mp4'])
  assert.deepEqual(readdirSync(join(root, 'downloads')), [], 'temporary download folders are cleaned up')
  assert.deepEqual(saved.flowwallDownloads.map((item) => item.state), ['completed', 'failed', 'duplicate', 'completed'])

  service.detachFlowWallView()
  assert.equal(win.contentView.children.length, 0)
  server.close()
  console.log('FLOWWALL_SMOKE_PASS ' + JSON.stringify({ isolation, imports: imports.map((item) => item.file), states: events.filter((event) => !['downloading', 'importing'].includes(event.state)).map((event) => event.state) }))
}

run().then(() => {
  clearTimeout(watchdog)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  clearTimeout(watchdog)
  app.exit(1)
})
