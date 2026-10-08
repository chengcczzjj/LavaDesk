import { Fragment, useMemo, type ReactNode } from 'react'
import { looksLikeMarkdown, parseMarkdown, type MarkdownBlock, type MarkdownInline } from '@shared/markdown'
import './chat-shared.css'

function renderInline(nodes: MarkdownInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    switch (node.type) {
      case 'text': return <Fragment key={key}>{node.text}</Fragment>
      case 'break': return <br key={key} />
      case 'code': return <code key={key} className="ly-md__code">{node.text}</code>
      case 'strong': return <strong key={key}>{renderInline(node.children, key)}</strong>
      case 'em': return <em key={key}>{renderInline(node.children, key)}</em>
      case 'link': return <a key={key} href={node.href} target="_blank" rel="noreferrer">{renderInline(node.children, key)}</a>
    }
  })
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `b${index}`
  switch (block.type) {
    case 'heading': {
      const Tag = (['h3', 'h3', 'h4', 'h5'] as const)[block.level - 1]
      return <Tag key={key} className="ly-md__heading">{renderInline(block.children, key)}</Tag>
    }
    case 'paragraph': return <p key={key}>{renderInline(block.children, key)}</p>
    case 'quote': return <blockquote key={key}>{renderInline(block.children, key)}</blockquote>
    case 'hr': return <hr key={key} />
    case 'code': return <pre key={key} className="ly-md__pre"><code>{block.text}</code></pre>
    case 'list': {
      const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)
      return block.ordered
        ? <ol key={key} start={block.start}>{items}</ol>
        : <ul key={key}>{items}</ul>
    }
    case 'table': return (
      <div key={key} className="ly-md__table-wrap">
        <table>
          <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell, `${key}-h${cellIndex}`)}</th>)}</tr></thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell, `${key}-${rowIndex}-${cellIndex}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
}

/**
 * Chat reply text. Plain conversational replies keep their light pre-wrap
 * rendering; replies with lists, headings, code or tables render as Markdown
 * through React elements (never raw HTML).
 */
export function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => (looksLikeMarkdown(text) ? parseMarkdown(text) : null), [text])
  if (!blocks) return <span className={`ly-md ly-md--plain ${className}`}>{text}</span>
  return <div className={`ly-md ${className}`}>{blocks.map(renderBlock)}</div>
}
