// ZIP entry path validation (prevents path traversal / zip-slip on import).
import path from 'node:path'

export function safeZipEntryPath(entry: string): string | null {
  if (!entry || entry.includes('\0')) return null
  const norm = entry.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null
  const parts = norm.split('/')
  if (parts.some((p) => p === '..')) return null
  const resolved = path.posix.normalize(norm)
  if (resolved.startsWith('..') || resolved.startsWith('/')) return null
  return resolved
}

/** Resolve a child path and verify it stays inside root. */
export function resolveInside(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel)
  const r = path.resolve(root)
  return abs === r || abs.startsWith(r + path.sep) ? abs : null
}
