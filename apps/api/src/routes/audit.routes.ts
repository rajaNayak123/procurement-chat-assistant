import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';

export const auditRouter = Router();

// GET /api/audit
auditRouter.get('/audit', async (req: Request, res: Response) => {
  const { entity_type, actor, action } = req.query;

  const where: any = {};
  if (entity_type) where.entity_type = String(entity_type);
  if (actor) where.actor = String(actor);
  if (action) where.action = String(action);

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  return res.json(logs);
});
