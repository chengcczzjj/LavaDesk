import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { MAX_ATTACHMENT_BYTES, MAX_IMAGE_ATTACHMENT_BYTES, attachmentKindFromExtension, type ChatAttachment } from '@shared/chat-attachments'

type AttachResult = { attachments: ChatAttachment[]; rejected: { name: string; reason: string }[] }
type AttachData = (files: { name: string; bytes: Uint8Array }[]) => Promise<AttachResult>

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Clipboard screenshots are all called "image.png"; give them a name the user can tell apart. */
function displayName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const now = new Date()
  const ext = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/webp' ? '.webp' : file.type === 'image/gif' ? '.gif' : '.png'
  return `截图-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${ext}`
}

async function readFiles(files: File[]): Promise<{ items: { name: string; bytes: Uint8Array }[]; rejected: AttachResult['rejected'] }> {
  const items: { name: string; bytes: Uint8Array }[] = []
  const rejected: AttachResult['rejected'] = []
  for (const file of files.slice(0, 8)) {
    const name = displayName(file)
    const dot = name.lastIndexOf('.')
    const kind = attachmentKindFromExtension(dot >= 0 ? name.slice(dot) : '')
    const limit = kind === 'image' ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES
    // Folders dropped from Explorer show up as empty "files".
    if (file.size === 0) {
      rejected.push({ name, reason: '只能添加文件' })
    } else if (file.size > limit) {
      rejected.push({ name, reason: `文件超过 ${Math.round(limit / 1024 / 1024)}MB` })
    } else {
      items.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) })
    }
  }
  if (files.length > 8) rejected.push({ name: `另外 ${files.length - 8} 个文件`, reason: '一次最多 8 个' })
  return { items, rejected }
}

/**
 * Paste a screenshot or drop files into a chat surface. Contents go to the
 * main process as bytes, so a web page's path never becomes a read grant.
 */
export function useAttachmentDrop({
  attachData,
  onAttached,
  onRejected,
  disabled,
}: {
  attachData: AttachData
  onAttached: (attachments: ChatAttachment[]) => void
  onRejected: (message: string) => void
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const add = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const { items, rejected } = await readFiles(files)
    const result = items.length > 0 ? await attachData(items) : { attachments: [], rejected: [] }
    if (result.attachments.length > 0) onAttached(result.attachments)
    const problems = [...rejected, ...result.rejected]
    if (problems.length > 0) onRejected(problems.map((item) => `${item.name}：${item.reason}`).join('；'))
  }, [attachData, onAttached, onRejected])

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

  return {
    dragging,
    onPaste: (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0 || disabled) return
      event.preventDefault()
      void add(files)
    },
    dropProps: {
      onDragEnter: (event: DragEvent) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        depth.current += 1
        if (!disabled) setDragging(true)
      },
      onDragOver: (event: DragEvent) => {
        if (!hasFiles(event)) return
        // Always swallow file drags so Electron never navigates to the dropped file.
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      },
      onDragLeave: (event: DragEvent) => {
        if (!hasFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (event: DragEvent) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        depth.current = 0
        setDragging(false)
        if (!disabled) void add(Array.from(event.dataTransfer.files))
      },
    },
  }
}
