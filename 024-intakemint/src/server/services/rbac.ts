// Role-based access control matrix. Enforced server-side on every internal API call (see SECURITY.md).
import type { Role } from '../../shared/types'
import { forbidden, type Actor } from './context'

export type Permission =
  | 'read' | 'org.manage' | 'members.manage' | 'template.edit' | 'template.publish' | 'case.create' | 'case.edit'
  | 'case.delete' | 'review' | 'ready.signoff' | 'ready.override' | 'reminder.send' | 'link.manage' | 'package.generate'
  | 'export' | 'audit.read' | 'ai.run' | 'token.manage'

const MATRIX: Record<Role, Permission[]> = {
  owner: ['read', 'org.manage', 'members.manage', 'template.edit', 'template.publish', 'case.create', 'case.edit', 'case.delete', 'review', 'ready.signoff', 'ready.override', 'reminder.send', 'link.manage', 'package.generate', 'export', 'audit.read', 'ai.run', 'token.manage'],
  admin: ['read', 'org.manage', 'members.manage', 'template.edit', 'template.publish', 'case.create', 'case.edit', 'case.delete', 'review', 'ready.signoff', 'ready.override', 'reminder.send', 'link.manage', 'package.generate', 'export', 'audit.read', 'ai.run', 'token.manage'],
  manager: ['read', 'template.edit', 'template.publish', 'case.create', 'case.edit', 'case.delete', 'review', 'ready.signoff', 'ready.override', 'reminder.send', 'link.manage', 'package.generate', 'audit.read', 'ai.run'],
  editor: ['read', 'template.edit', 'case.create', 'case.edit', 'review', 'link.manage', 'package.generate', 'ai.run'],
  viewer: ['read'],
}

export function can(role: Role | undefined, p: Permission): boolean {
  return !!role && MATRIX[role].includes(p)
}

export function requirePerm(actor: Actor, p: Permission): void {
  if (actor.type === 'client') throw forbidden()
  if (actor.type === 'system') return
  if (!can(actor.role, p)) throw forbidden(`この操作には権限（${p}）が必要です`)
}

export const permissionMatrix = MATRIX
