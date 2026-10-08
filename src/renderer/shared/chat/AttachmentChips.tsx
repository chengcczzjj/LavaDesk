import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { formatAttachmentSize, type ChatAttachment } from '@shared/chat-attachments'
import './chat-shared.css'

export function AttachmentChips({ attachments, onRemove }: { attachments: ChatAttachment[]; onRemove?: (id: string) => void }) {
  if (attachments.length === 0) return null
  return (
    <div className="ly-attachments">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="ly-attachment" title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}>
          {attachment.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
          <span>{attachment.name}</span>
          {onRemove && (
            <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => onRemove(attachment.id)}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
