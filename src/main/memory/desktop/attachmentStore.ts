import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import type { ChatAttachment, ChatAttachmentKind } from '@shared/chat-attachments'
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_ATTACHMENT_BYTES, attachmentKindFromExtension } from '@shared/chat-attachments'
import { detectMediaSignature, isImageSignature } from '@shared/media-signature'
import { getChatDropsRoot, sanitizeUserDataSegment } from '../../runtime/userDataPaths'

/**
 * Files the user explicitly picked for a conversation. Each grant covers one
 * file the user chose; the companion can read nothing else outside a workspace.
 */
interface AttachmentGrant extends ChatAttachment {
  path: string
  conversationId: string | null
}

const MAX_GRANTS = 200
/** Pasted/dropped copies are only needed while their conversation is fresh. */
const DROP_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const grants = new Map<string, AttachmentGrant>()

async function pruneDrops(root: string): Promise<void> {
  const cutoff = Date.now() - DROP_RETENTION_MS
  const names = await fs.readdir(root).catch(() => [] as string[])
  await Promise.all(names.map(async (name) => {
    const filePath = join(root, name)
    const stat = await fs.stat(filePath).catch(() => null)
    if (stat?.isFile() && stat.mtimeMs < cutoff) await fs.rm(filePath, { force: true }).catch(() => undefined)
  }))
}

function remember(grant: AttachmentGrant): void {
  grants.set(grant.id, grant)
  if (grants.size > MAX_GRANTS) {
    const oldest = grants.keys().next().value
    if (oldest) grants.delete(oldest)
  }
}

export const AttachmentStore = {
  async register(paths: string[], conversationId: string | null): Promise<{ attachments: ChatAttachment[]; rejected: { name: string; reason: string }[] }> {
    const attachments: ChatAttachment[] = []
    const rejected: { name: string; reason: string }[] = []
    for (const filePath of paths.slice(0, 8)) {
      const name = basename(filePath)
      try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) {
          rejected.push({ name, reason: '只能添加文件' })
          continue
        }
        const kind: ChatAttachmentKind = attachmentKindFromExtension(extname(filePath))
        const limit = kind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES
        if (stat.size > limit) {
          rejected.push({ name, reason: `文件超过 ${Math.round(limit / 1024 / 1024)}MB` })
          continue
        }
        const grant: AttachmentGrant = { id: `att-${randomUUID().slice(0, 10)}`, name, kind, size: stat.size, path: filePath, conversationId }
        remember(grant)
        attachments.push({ id: grant.id, name: grant.name, kind: grant.kind, size: grant.size })
      } catch {
        rejected.push({ name, reason: '文件读取失败' })
      }
    }
    return { attachments, rejected }
  },

  /**
   * Pasted screenshots and dropped files arrive as bytes, not paths: the
   * renderer can only hand over content the user gave it, never point the
   * companion at some other file on disk.
   */
  async registerData(files: { name: string; bytes: Uint8Array }[], conversationId: string | null): Promise<{ attachments: ChatAttachment[]; rejected: { name: string; reason: string }[] }> {
    const attachments: ChatAttachment[] = []
    const rejected: { name: string; reason: string }[] = []
    const root = getChatDropsRoot()
    await fs.mkdir(root, { recursive: true })
    void pruneDrops(root)
    for (const file of files.slice(0, 8)) {
      const name = sanitizeUserDataSegment(basename(file.name), 'pasted.png').slice(0, 100)
      const kind: ChatAttachmentKind = attachmentKindFromExtension(extname(name))
      const limit = kind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES
      if (file.bytes.byteLength === 0) {
        rejected.push({ name, reason: '文件是空的' })
        continue
      }
      if (file.bytes.byteLength > limit) {
        rejected.push({ name, reason: `文件超过 ${Math.round(limit / 1024 / 1024)}MB` })
        continue
      }
      if (kind === 'image' && !isImageSignature(detectMediaSignature(file.bytes.subarray(0, 16)))) {
        rejected.push({ name, reason: '不是有效的图片' })
        continue
      }
      const id = `att-${randomUUID().slice(0, 10)}`
      const filePath = join(root, `${id}${extname(name).toLowerCase()}`)
      try {
        await fs.writeFile(filePath, file.bytes)
      } catch {
        rejected.push({ name, reason: '保存失败' })
        continue
      }
      const grant: AttachmentGrant = { id, name, kind, size: file.bytes.byteLength, path: filePath, conversationId }
      remember(grant)
      attachments.push({ id, name, kind, size: grant.size })
    }
    return { attachments, rejected }
  },

  get(id: string): AttachmentGrant | undefined {
    return grants.get(id)
  },

  /** Attachments stay usable in the conversation they were sent in (and in a new one they started). */
  bind(ids: readonly string[], conversationId: string): ChatAttachment[] {
    const result: ChatAttachment[] = []
    for (const id of ids) {
      const grant = grants.get(id)
      if (!grant) continue
      if (grant.conversationId && grant.conversationId !== conversationId) continue
      grant.conversationId = conversationId
      result.push({ id: grant.id, name: grant.name, kind: grant.kind, size: grant.size })
    }
    return result
  },

  listForConversation(conversationId: string): ChatAttachment[] {
    return [...grants.values()]
      .filter((grant) => grant.conversationId === conversationId)
      .map(({ id, name, kind, size }) => ({ id, name, kind, size }))
  },
}
