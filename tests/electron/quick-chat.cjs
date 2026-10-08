/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Electron acceptance entry. */
// Production quick-chat renderer + sandboxed preload with a scripted main process:
// history rendering, sending, a suspended action confirmed on the card, undo from a receipt,
// receipts that expired with a restart, recalling the last message and dropping a file.
const { app, BrowserWindow, ipcMain } = require('electron')
const process = require('node:process')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { console, setTimeout, clearTimeout, Buffer } = globalThis
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let win
const watchdog = setTimeout(() => { console.error('QUICK_CHAT_TIMEOUT'); app.exit(1) }, 45000)
app.on('window-all-closed', () => {})

async function waitFor(code, label) {
  for (let i = 0; i < 160; i++) {
    let value
    try {
      value = await win.webContents.executeJavaScript(code)
    } catch (error) {
      throw new Error(`${label}: ${error.message}`)
    }
    if (value) return
    await sleep(50)
  }
  throw new Error('Timed out: ' + label)
}
async function clickText(selector, text) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)}))
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
}

async function clickUndo(summary) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const receipt = [...document.querySelectorAll('.ly-receipt')].find((node) => node.textContent.includes(${JSON.stringify(summary)}))
    const r = receipt.querySelector('.ly-receipt__undo').getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
}

async function run() {
  const root = process.env.LINGYUE_SMOKE_ROOT
  assert.ok(root, 'Run through tests/electron/run-smoke.mjs for post-exit cleanup')
  app.setPath('userData', join(root, 'userData'))
  app.setPath('sessionData', join(root, 'sessionData'))
  const { createTsLoader, projectRoot } = await import('../helpers/load-ts.mjs')
  const { IPC } = createTsLoader()('src/shared/ipc-channels.ts')
  await app.whenReady()

  const sent = []
  const resolved = []
  const undone = []
  const dropped = []
  const history = [
    { id: 'e1', conversationId: 'c1', eventType: 'user_message', content: { text: '把天气放到右上角' }, createdAt: 1 },
    { id: 'e2', conversationId: 'c1', eventType: 'tool_result', content: { toolName: 'arrange_widget', output: { ok: true, receipt: { id: 'j-old', summary: '调整天气', undoable: true } } }, createdAt: 2 },
    { id: 'e3', conversationId: 'c1', eventType: 'assistant_message', content: { text: '放好啦：\n- 天气在右上\n- 不喜欢可以撤回' }, createdAt: 3 },
  ]
  ipcMain.handle(IPC.CHAT_GET_QUICK_CONVERSATION, () => ({ conversationId: 'c1', history }))
  ipcMain.handle(IPC.CHAT_ACTION_UNDO, (_event, id) => { undone.push(id); return { ok: true, summary: '调整天气' } })
  // The history receipt belongs to a previous app session: its journal entry is gone.
  ipcMain.handle(IPC.CHAT_ACTION_STATUS, (_event, ids) => Object.fromEntries(ids.map((id) => [id, id === 'j-old' ? 'expired' : 'active'])))
  ipcMain.handle(IPC.CHAT_ATTACH_DATA, (_event, files, conversationId) => {
    dropped.push({ conversationId, files: files.map((file) => ({ name: file.name, size: file.bytes.byteLength, isBytes: file.bytes instanceof Uint8Array })) })
    return { attachments: files.map((file, index) => ({ id: `att-${index}`, name: file.name, kind: 'text', size: file.bytes.byteLength })), rejected: [] }
  })
  ipcMain.handle(IPC.CHAT_ACTION_CONFIRM_RESOLVE, (_event, confirmId, decision) => {
    resolved.push([confirmId, decision])
    const { streamId } = sent.at(-1)
    win.webContents.send(IPC.CHAT_TOOL_CALL, { streamId, toolCallId: 't1', toolName: 'app_control', input: { action: 'open', query: '记事本' }, status: 'start' })
    win.webContents.send(IPC.CHAT_TOOL_CALL, { streamId, toolCallId: 't1', toolName: 'app_control', status: 'complete', output: { ok: true, app: '记事本' } })
    win.webContents.send(IPC.CHAT_TOOL_CALL, { streamId, toolCallId: 't2', toolName: 'add_widget', input: { type: 'text' }, status: 'start' })
    win.webContents.send(IPC.CHAT_TOOL_CALL, { streamId, toolCallId: 't2', toolName: 'add_widget', status: 'complete', output: { ok: true, receipt: { id: 'j-new', summary: '新增桌面文字', undoable: true } } })
    win.webContents.send(IPC.CHAT_STREAM_CHUNK, { streamId, delta: '记事本打开啦，**便签**也放好了。' })
    setTimeout(() => win.webContents.send(IPC.CHAT_STREAM_END, { streamId, full: '记事本打开啦，**便签**也放好了。', conversationId: 'c1' }), 50)
    return true
  })
  ipcMain.on(IPC.CHAT_SEND_MESSAGE, (_event, request) => {
    sent.push(request)
    win.webContents.send(IPC.CHAT_ACTION_CONFIRM_REQUEST, {
      confirmId: '00000000-0000-4000-8000-000000000001',
      streamId: request.streamId,
      toolName: 'app_control',
      title: '要我帮你打开「记事本」吗？',
      detail: 'Windows 自带工具。',
      risk: 'high',
      rememberKey: 'app:记事本',
      expiresAt: Date.now() + 120000,
    })
  })

  win = new BrowserWindow({ show: false, width: 400, height: 560, frame: false, webPreferences: {
    sandbox: true, contextIsolation: true, preload: join(projectRoot, 'out/preload/index.js'),
    offscreen: true, additionalArguments: ['--lingyue-window-role=quick-chat'], backgroundThrottling: false,
  } })
  await win.loadFile(join(projectRoot, 'out/renderer/quick-chat/index.html'))
  const bridges = await win.webContents.executeJavaScript('({ quickChat: typeof window.quickChat, lingyue: typeof window.lingyue, canvas: typeof window.canvasBridge })')
  assert.deepEqual(bridges, { quickChat: 'object', lingyue: 'undefined', canvas: 'undefined' }, 'quick chat gets only its own bridge')

  await waitFor(`document.querySelectorAll('.qc__msg li').length === 2`, 'markdown history')
  await waitFor(`[...document.querySelectorAll('.ly-receipt')].some((node) => node.textContent.includes('调整天气'))`, 'history receipt')
  await waitFor(`(() => {
    const receipt = [...document.querySelectorAll('.ly-receipt')].find((node) => node.textContent.includes('调整天气'))
    return receipt.classList.contains('ly-receipt--expired') && !receipt.querySelector('.ly-receipt__undo')
  })()`, 'expired history receipt offers no undo')

  await win.webContents.executeJavaScript(`document.querySelector('.qc__input-row textarea').focus()`)
  win.webContents.insertText('打开记事本，再放个便签')
  await sleep(80)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await waitFor(`document.querySelector('.ly-confirm') !== null`, 'confirmation card')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].payload.conversationId, 'c1')
  assert.equal(sent[0].payload.text, '打开记事本，再放个便签')
  const confirmText = await win.webContents.executeJavaScript(`document.querySelector('.ly-confirm').textContent`)
  assert.match(confirmText, /要我帮你打开「记事本」吗？/)
  assert.match(confirmText, /以后都直接做/)

  await clickText('.ly-confirm button', '好的')
  await waitFor(`document.querySelector('.ly-confirm') === null && [...document.querySelectorAll('.qc__msg--assistant strong')].some((node) => node.textContent === '便签')`, 'reply after confirmation')
  assert.deepEqual(resolved, [['00000000-0000-4000-8000-000000000001', 'allow']])

  await waitFor(`[...document.querySelectorAll('.ly-receipt')].some((node) => node.textContent.includes('新增桌面文字'))`, 'live receipt kept on the reply')
  await clickUndo('新增桌面文字')
  await waitFor(`[...document.querySelectorAll('.ly-receipt--undone')].some((node) => node.textContent.includes('已撤回：新增桌面文字'))`, 'undone receipt')
  assert.deepEqual(undone, ['j-new'])

  // ↑ in an empty box brings back the last thing the user said.
  await win.webContents.executeJavaScript(`document.querySelector('.qc__input-row textarea').focus()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' })
  await waitFor(`document.querySelector('.qc__input-row textarea').value === '打开记事本，再放个便签'`, 'recalled last message')

  // A file dropped on the window reaches the main process as bytes and becomes a chip.
  await win.webContents.executeJavaScript(`(() => {
    const data = new DataTransfer()
    data.items.add(new File(['买牛奶\\n交电费'], 'todo.txt', { type: 'text/plain' }))
    const target = document.querySelector('.qc')
    target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
  })()`)
  await waitFor(`[...document.querySelectorAll('.qc__composer .ly-attachment')].some((node) => node.textContent.includes('todo.txt'))`, 'dropped file chip')
  assert.deepEqual(dropped, [{ conversationId: 'c1', files: [{ name: 'todo.txt', size: Buffer.byteLength('买牛奶\n交电费'), isBytes: true }] }])

  console.log('QUICK_CHAT_SMOKE_PASS ' + JSON.stringify({ bridges, sent: sent.length, resolved: resolved[0][1], undone, dropped: dropped[0].files[0].name }))
}

run().then(() => {
  clearTimeout(watchdog)
  app.exit(0)
}).catch((error) => {
  console.error(error)
  clearTimeout(watchdog)
  app.exit(1)
})
