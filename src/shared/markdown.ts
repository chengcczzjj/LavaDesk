/**
 * Small Markdown subset for chat replies. It produces a tree the renderer
 * turns into React elements, so model output is never injected as HTML.
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'break' }

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownInline[][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: MarkdownInline[] }
  | { type: 'table'; header: MarkdownInline[][]; rows: MarkdownInline[][][] }
  | { type: 'hr' }

const SAFE_LINK = /^(https?:\/\/|mailto:)/i

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const result: MarkdownInline[] = []
  let text = ''
  const flush = () => {
    if (text) result.push({ type: 'text', text })
    text = ''
  }
  let index = 0
  while (index < source.length) {
    const rest = source.slice(index)
    if (rest.startsWith('\n')) {
      flush()
      result.push({ type: 'break' })
      index += 1
      continue
    }
    const code = /^`([^`\n]+)`/.exec(rest)
    if (code) {
      flush()
      result.push({ type: 'code', text: code[1] })
      index += code[0].length
      continue
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/.exec(rest)
    if (strong) {
      flush()
      result.push({ type: 'strong', children: parseMarkdownInline(strong[2]) })
      index += strong[0].length
      continue
    }
    const em = /^(\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1(?![*_\w])/.exec(rest)
    if (em && !(em[1] === '_' && /\w$/.test(source.slice(0, index)))) {
      flush()
      result.push({ type: 'em', children: parseMarkdownInline(em[2]) })
      index += em[0].length
      continue
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link && SAFE_LINK.test(link[2])) {
      flush()
      result.push({ type: 'link', href: link[2], children: parseMarkdownInline(link[1]) })
      index += link[0].length
      continue
    }
    const bareUrl = /^https?:\/\/[^\s<>()（）]+[^\s<>()（）.,;:!?。，；：！？、"'”’]/.exec(rest)
    if (bareUrl && !/[\w/]$/.test(source.slice(0, index))) {
      flush()
      result.push({ type: 'link', href: bareUrl[0], children: [{ type: 'text', text: bareUrl[0] }] })
      index += bareUrl[0].length
      continue
    }
    text += source[index]
    index += 1
  }
  flush()
  return result
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_ITEM = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  const flushParagraph = () => {
    const text = paragraph.join('\n').trim()
    if (text) blocks.push({ type: 'paragraph', children: parseMarkdownInline(text) })
    paragraph = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      flushParagraph()
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        body.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    const heading = /^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4, children: parseMarkdownInline(heading[2]) })
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph()
      blocks.push({ type: 'hr' })
      continue
    }
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      flushParagraph()
      const header = splitTableRow(line).map(parseMarkdownInline)
      const rows: MarkdownInline[][][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]).map(parseMarkdownInline))
        index += 1
      }
      index -= 1
      blocks.push({ type: 'table', header, rows })
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      index -= 1
      blocks.push({ type: 'quote', children: parseMarkdownInline(quote.join('\n')) })
      continue
    }
    const listItem = LIST_ITEM.exec(line)
    if (listItem) {
      flushParagraph()
      const ordered = /\d/.test(listItem[1])
      const start = ordered ? Number.parseInt(listItem[1], 10) : 1
      const items: string[] = []
      while (index < lines.length) {
        const current = LIST_ITEM.exec(lines[index])
        if (current && /\d/.test(current[1]) === ordered) {
          items.push(current[2])
        } else if (lines[index].trim() && /^\s{2,}\S/.test(lines[index]) && items.length > 0) {
          items[items.length - 1] += `\n${lines[index].trim()}`
        } else {
          break
        }
        index += 1
      }
      index -= 1
      blocks.push({ type: 'list', ordered, start, items: items.map(parseMarkdownInline) })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

/** Cheap check so plain chatty replies keep their existing light rendering. */
export function looksLikeMarkdown(source: string): boolean {
  return /(^|\n)\s{0,3}(#{1,4}\s|[-*+]\s|\d{1,3}[.)]\s|>|```)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:|\|\s*-{3,}/.test(source)
}
