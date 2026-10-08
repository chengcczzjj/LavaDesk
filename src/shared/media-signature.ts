/** Identify a file from its first bytes; received files are trusted by content, not by name. */
export type MediaSignature = 'mp4' | 'webm' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'zip'

export function detectMediaSignature(bytes: Uint8Array): MediaSignature | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  if (bytes.length >= 12 && ascii(4, 4) === 'ftyp') return 'mp4'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'gif'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp'
  if (bytes.length >= 14 && ascii(0, 2) === 'BM') return 'bmp'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  return null
}

export function isImageSignature(signature: MediaSignature | null): boolean {
  return signature === 'png' || signature === 'jpeg' || signature === 'gif' || signature === 'webp' || signature === 'bmp'
}
