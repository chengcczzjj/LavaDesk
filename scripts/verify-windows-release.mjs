// Verifies a local `electron-builder --win --publish never` output before it is
// uploaded: the update manifest must describe the exact installer, and the
// packaged app must carry this version and every process entry point.
//
// Usage: node scripts/verify-windows-release.mjs [--summary <file>]
// Writes a Markdown verification section to --summary when given.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { URL, fileURLToPath } from 'node:url'
import process from 'node:process'
import console from 'node:console'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

function hashFile(path, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm)
    createReadStream(path).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest(encoding)))
  })
}

/** Minimal reader for electron-builder's latest.yml (flat keys plus one files list). */
function readManifest(raw) {
  const text = raw.replace(/\r\n/g, '\n')
  const scalar = (key) => new RegExp(`^${key}:\\s*'?([^'\\n]+)'?\\s*$`, 'm').exec(text)?.[1]?.trim()
  const files = [...text.matchAll(/^\s+- url:\s*(.+)\n\s+sha512:\s*(.+)\n\s+size:\s*(\d+)/gm)]
    .map((match) => ({ url: match[1].trim(), sha512: match[2].trim(), size: Number(match[3]) }))
  return { version: scalar('version'), path: scalar('path'), sha512: scalar('sha512'), files }
}

const { version, productName } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
// electron-builder.yml → nsis.artifactName: ${productName}-Setup-${version}.${ext}
const installerName = `${productName}-Setup-${version}.exe`
const installer = join(dist, installerName)
const blockmap = `${installer}.blockmap`
const manifest = readManifest(await readFile(join(dist, 'latest.yml'), 'utf8'))

const [installerStat, blockmapStat] = await Promise.all([stat(installer), stat(blockmap)])
const [sha512, sha256] = await Promise.all([hashFile(installer, 'sha512', 'base64'), hashFile(installer, 'sha256', 'hex')])

check(manifest.version === version, `latest.yml version ${manifest.version} != package.json ${version}`)
check(manifest.path === installerName, `latest.yml path ${manifest.path} != ${installerName}`)
check(manifest.sha512 === sha512, 'latest.yml top-level sha512 does not match the installer')
check(manifest.files.length === 1, `latest.yml lists ${manifest.files.length} files, expected 1`)
const [entry] = manifest.files
check(entry?.url === installerName, `latest.yml files[0].url ${entry?.url} != ${installerName}`)
check(entry?.sha512 === sha512, 'latest.yml files[0].sha512 does not match the installer')
check(entry?.size === installerStat.size, `latest.yml size ${entry?.size} != installer ${installerStat.size}`)
check(blockmapStat.size > 0, 'blockmap is empty')

const asar = require('@electron/asar')
const appAsar = join(dist, 'win-unpacked', 'resources', 'app.asar')
const packaged = new Set(asar.listPackage(appAsar).map((entryPath) => entryPath.replace(/\\/g, '/')))
const packagedJson = JSON.parse(asar.extractFile(appAsar, 'package.json').toString('utf8'))
check(packagedJson.version === version, `app.asar package.json version ${packagedJson.version} != ${version}`)
// productName decides the userData folder that the LingyueDesk data migration copies into.
check(packagedJson.productName === productName, `app.asar package.json productName ${packagedJson.productName} != ${productName}`)
for (const required of [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/main-ui/index.html',
  '/out/renderer/wallpaper/index.html',
  '/out/renderer/canvas/index.html',
]) {
  check(packaged.has(required), `app.asar is missing ${required}`)
}

if (failures.length > 0) {
  console.error(`Release verification failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

const summary = [
  '## 构建校验（CI 自动生成）',
  '',
  `- 安装包：${installerName}（${installerStat.size.toLocaleString('en-US')} bytes）`,
  `- SHA-256：${sha256.toUpperCase()}`,
  `- electron-updater SHA-512：${sha512}`,
  `- blockmap：${installerName}.blockmap（${blockmapStat.size.toLocaleString('en-US')} bytes）`,
  `- latest.yml：版本 ${version}，文件名、大小与 SHA-512 均与安装包一致`,
  `- app.asar：版本 ${packagedJson.version}，包含主进程、preload 及主界面/壁纸/画布三个渲染入口`,
  '',
].join('\n')
const summaryIndex = process.argv.indexOf('--summary')
if (summaryIndex > 0 && process.argv[summaryIndex + 1]) await writeFile(process.argv[summaryIndex + 1], summary)
console.log(summary)
