import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import console from 'node:console'
import { projectRoot } from '../helpers/load-ts.mjs'

const require = createRequire(import.meta.url)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
await mkdir(join(projectRoot, 'out'), { recursive: true })
const markers = {
  'wallpaper-sandbox': 'SANDBOX_SMOKE_PASS ',
  'wallpaper-renderer': 'RENDERER_SMOKE_PASS ',
  'library-toolbar': 'LIBRARY_TOOLBAR_SMOKE_PASS ',
  'quick-chat': 'QUICK_CHAT_SMOKE_PASS ',
  flowwall: 'FLOWWALL_SMOKE_PASS ',
}
for (const [name, marker] of Object.entries(markers)) {
  let output = ''
  const scratch = await mkdtemp(join(tmpdir(), 'lingyue-smoke-run-'))
  const rel = relative(resolve(tmpdir()), resolve(scratch))
  if (isAbsolute(rel) || !rel.startsWith('lingyue-smoke-run-') || rel.includes('..')) throw new Error('Invalid smoke scratch path')
  let code
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [join(projectRoot, 'tests/electron', name + '.cjs')], {
        cwd: projectRoot, windowsHide: true, env: { ...env, LINGYUE_SMOKE_ROOT: scratch }, stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', (data) => { output += data })
      child.stderr.on('data', (data) => { output += data })
      child.on('error', reject)
      child.on('close', resolve)
    })
  } finally {
    // Chromium releases profile databases only after the child process exits.
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  await writeFile(join(projectRoot, 'out', name + '.log'), output)
  console.log(output.trim())
  if (code !== 0 || !output.includes(marker)) throw new Error(name + ' failed acceptance (exit ' + code + ')')
}
