import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { loadEngineContext } from '../services/data.service.js';
import {
  computePreferredSuppliers,
  selectPolicyVersionForDate,
  toCalendarDateString,
  getAppNow,
} from '@cantill/engine';
import { generatePreferredSuppliersCSV } from '../services/export.service.js';

export const suppliersRouter = Router();

// GET /api/items
suppliersRouter.get('/items', async (_req: Request, res: Response) => {
  const items = await prisma.item.findMany({
    orderBy: { item_code: 'asc' },
  });
  return res.json(items);
});

// GET /api/suppliers
suppliersRouter.get('/suppliers', async (_req: Request, res: Response) => {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { supplier_id: 'asc' },
  });
  return res.json(suppliers);
});

// GET /api/preferred-suppliers?item_code=&as_of=
suppliersRouter.get('/preferred-suppliers', async (req: Request, res: Response) => {
  const itemCode = req.query.item_code as string;
  if (!itemCode) {
    return res.status(400).json({ error: 'item_code query parameter required' });
  }

  const asOf = (req.query.as_of as string) || toCalendarDateString(getAppNow());
  const context = await loadEngineContext();
  const policy = selectPolicyVersionForDate(asOf, context.policy_versions);

  const { preferred, excluded } = computePreferredSuppliers(
    itemCode,
    asOf,
    context.suppliers,
    context.po_history,
    context.contracts,
    context.contract_lines,
    policy
  );

  return res.json({
    item_code: itemCode,
    as_of: asOf,
    policy_version: policy.version,
    preferred,
    excluded,
  });
});

// GET /api/preferred-suppliers/export?as_of=
suppliersRouter.get('/preferred-suppliers/export', async (req: Request, res: Response) => {
  const asOf = (req.query.as_of as string) || toCalendarDateString(getAppNow());
  const context = await loadEngineContext();
  const policy = selectPolicyVersionForDate(asOf, context.policy_versions);

  const allRankings: Array<{ item_code: string; ranks: any[] }> = [];

  for (const item of context.items) {
    const { preferred } = computePreferredSuppliers(
      item.item_code,
      asOf,
      context.suppliers,
      context.po_history,
      context.contracts,
      context.contract_lines,
      policy
    );
    allRankings.push({
      item_code: item.item_code,
      ranks: preferred,
    });
  }

  const csvStr = generatePreferredSuppliersCSV(allRankings);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="preferred_suppliers_${asOf}.csv"`);
  return res.send(csvStr);
});
