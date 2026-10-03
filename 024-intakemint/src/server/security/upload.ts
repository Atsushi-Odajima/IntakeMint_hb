// Upload validation: extension allow-list x magic-byte sniffing x size. Original bytes are stored unchanged.
export interface UploadCheck { ok: boolean; mime?: string; ext?: string; error?: string }

const SIGS: { ext: string[]; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: ['png'], mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: ['jpg', 'jpeg'], mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ['gif'], mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: ['webp'], mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: ['heic', 'heif'], mime: 'image/heic', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /hei|mif1|msf1|heix|hevc/.test(b.subarray(8, 12).toString('latin1')) },
  { ext: ['mp4', 'mov'], mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // Adobe Illustrator files (modern) are PDF-compatible; EPS is PostScript.
  { ext: ['pdf', 'ai'], mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: ['eps', 'ai'], mime: 'application/postscript', test: (b) => b.subarray(0, 4).toString('latin1') === '%!PS' || (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) },
  { ext: ['zip', 'docx', 'xlsx', 'pptx'], mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) },
]

const OOXML: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function looksLikeText(b: Buffer): boolean {
  const n = Math.min(b.length, 4096)
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0) return false }
  return true
}

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file'
  // strip control chars & reserved characters, keep unicode (Japanese) names
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '_').slice(0, 180)
  return clean || 'file'
}

export function checkUpload(filename: string, buf: Buffer, acceptedExts: string[] | undefined, maxBytes: number): UploadCheck {
  const ext = extOf(filename)
  if (!ext) return { ok: false, error: '拡張子のないファイルは受け付けできません' }
  if (acceptedExts && acceptedExts.length && !acceptedExts.includes(ext)) return { ok: false, error: `この項目では .${acceptedExts.join(' / .')} のみ受け付けます` }
  if (buf.length === 0) return { ok: false, error: '空のファイルです' }
  if (buf.length > maxBytes) return { ok: false, error: `ファイルサイズが上限（${Math.round(maxBytes / 1024 / 1024)}MB）を超えています` }
  if (ext === 'svg') {
    const head = buf.subarray(0, 2048).toString('utf8')
    if (!looksLikeText(buf) || !/<svg[\s>]/i.test(head)) return { ok: false, error: 'SVGファイルとして読み取れません' }
    // SVG is stored as-is but always served as attachment / with CSP sandbox (scripts never execute).
    return { ok: true, mime: 'image/svg+xml', ext }
  }
  if (ext === 'txt' || ext === 'csv' || ext === 'md') {
    return looksLikeText(buf) ? { ok: true, mime: ext === 'csv' ? 'text/csv' : 'text/plain', ext } : { ok: false, error: 'テキストファイルとして読み取れません' }
  }
  const sig = SIGS.find((s) => s.ext.includes(ext) && s.test(buf))
  if (!sig) return { ok: false, error: `ファイルの中身が拡張子（.${ext}）と一致しません` }
  return { ok: true, mime: OOXML[ext] ?? sig.mime, ext }
}
