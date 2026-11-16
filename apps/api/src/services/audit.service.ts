import { prisma } from '../prisma.js';

export async function logAuditEvent(
  entityType: string,
  entityId: string,
  action: string,
  actor: string,
  role: string,
  diff?: any
) {
  return prisma.auditLog.create({
    data: {
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor,
      role,
      diff_json: diff ? JSON.stringify(diff) : null,
    },
  });
}
