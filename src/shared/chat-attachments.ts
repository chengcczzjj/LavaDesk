export type ChatAttachmentKind = 'image' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'other'

/** What chat surfaces and the model see about a file the user attached (never its path). */
export interface ChatAttachment {
  id: string
  name: string
  kind: ChatAttachmentKind
  size: number
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.xml', '.yaml', '.yml', '.ini', '.toml',
  '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.sql', '.sh', '.bat', '.ps1',
])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function attachmentKindFromExtension(extension: string): ChatAttachmentKind {
  const ext = extension.toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx') return 'xlsx'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'other'
}

export function imageMediaType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.bmp') return 'image/bmp'
  return 'image/png'
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
