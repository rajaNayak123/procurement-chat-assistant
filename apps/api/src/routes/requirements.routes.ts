import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { logAuditEvent } from '../services/audit.service.js';
import { loadEngineContext } from '../services/data.service.js';
import { computePreferredSuppliers } from '@cantill/engine';

export const requirementsRouter = Router();

// GET /api/requirements
requirementsRouter.get('/requirements', async (req: Request, res: Response) => {
  const { route, plant, status } = req.query;

  const where: any = {};
  if (route) where.route = String(route);
  if (plant) where.plant = String(plant);
  if (status) where.status = String(status);

  const requirements = await prisma.requirement.findMany({
    where,
    orderBy: [{ created_at: 'desc' }],
  });

  return res.json(requirements);
});

// GET /api/requirements/:id
requirementsRouter.get('/requirements/:id', async (req: Request, res: Response) => {
  const requirement = await prisma.requirement.findFirst({
    where: {
      OR: [{ id: req.params.id }, { group_id: req.params.id }],
    },
    orderBy: { created_at: 'desc' },
  });

  if (!requirement) {
    return res.status(404).json({ error: 'Requirement not found' });
  }

  // Fetch PR lines forming this requirement
  const prLines = await prisma.pRLine.findMany({
    where: {
      OR: [
        { requirement_id: requirement.id },
        { requirement_id: requirement.group_id || '' },
      ],
    },
  });

  // Fetch candidate contracts and preferred suppliers for explainability
  const context = await loadEngineContext();
  const { preferred, excluded } = computePreferredSuppliers(
    requirement.item_code,
    requirement.requirement_date,
    context.suppliers,
    context.po_history,
    context.contracts,
    context.contract_lines
  );

  const candidateContracts = context.contracts
    .filter((c) =>
      context.contract_lines.some(
        (l) => l.contract_id === c.contract_id && l.item_code.toUpperCase() === requirement.item_code.toUpperCase()
      )
    )
    .map((c) => {
      const line = context.contract_lines.find(
        (l) => l.contract_id === c.contract_id && l.item_code.toUpperCase() === requirement.item_code.toUpperCase()
      );
      const supplier = context.suppliers.find((s) => s.supplier_id === c.supplier_id);
      return {
        ...c,
        rate: line?.rate,
        supplier_status: supplier?.status || 'Unknown',
      };
    });

  // Fetch override history if any
  const overrides = await prisma.override.findMany({
    where: { requirement_id: req.params.id },
    orderBy: { created_at: 'desc' },
  });

  return res.json({
    requirement,
    lines: prLines,
    preferred_suppliers: preferred,
    excluded_suppliers: excluded,
    candidate_contracts: candidateContracts,
    overrides,
  });
});

// POST /api/requirements/:id/approve
requirementsRouter.post('/requirements/:id/approve', async (req: Request, res: Response) => {
  const requirement = await prisma.requirement.findFirst({
    where: {
      OR: [{ id: req.params.id }, { group_id: req.params.id }],
    },
    orderBy: { created_at: 'desc' },
  });

  if (!requirement) {
    return res.status(404).json({ error: 'Requirement not found' });
  }

  if (requirement.status === 'approved') {
    return res.status(400).json({ error: 'Requirement is already approved and locked' });
  }

  const { actor = 'Buyer Demo', role = 'Buyer', comment = '' } = req.body;

  // Capex requires second approval by Procurement Head
  if (requirement.route === 'CAPEX_SOURCING' && role !== 'Procurement Head') {
    return res.status(403).json({
      error: 'Capex requirements require approval from Procurement Head',
    });
  }

  // If CONTRACT_PO, record ledger consumption
  if (requirement.route === 'CONTRACT_PO' && requirement.supplier_id) {
    // Find contract
    const context = await loadEngineContext();
    const contract = context.contracts.find((c) => c.supplier_id === requirement.supplier_id);
    if (contract) {
      await prisma.contractConsumption.create({
        data: {
          contract_id: contract.contract_id,
          po_id: requirement.po_id,
          req_id: requirement.id,
          amount: requirement.group_value_inr,
        },
      });
    }
  }

  // Update requirement status
  const updated = await prisma.requirement.update({
    where: { id: requirement.id },
    data: {
      status: 'approved',
      approved_by: actor,
      approved_at: new Date(),
    },
  });

  // Log audit
  await logAuditEvent(
    'Requirement',
    requirement.id,
    'approve',
    actor,
    role,
    { status: 'approved', comment }
  );

  return res.json({ message: 'Requirement approved successfully', requirement: updated });
});

// POST /api/requirements/:id/override
requirementsRouter.post('/requirements/:id/override', async (req: Request, res: Response) => {
  const requirement = await prisma.requirement.findFirst({
    where: {
      OR: [{ id: req.params.id }, { group_id: req.params.id }],
    },
    orderBy: { created_at: 'desc' },
  });

  if (!requirement) {
    return res.status(404).json({ error: 'Requirement not found' });
  }

  const {
    actor = 'Buyer Demo',
    role = 'Buyer',
    comment,
    new_route,
    new_supplier_id,
    new_price,
    new_value,
  } = req.body;

  // Validate comment length (minimum 10 characters)
  if (!comment || comment.trim().length < 10) {
    return res.status(400).json({
      error: 'Override requires an explanatory comment of at least 10 characters',
    });
  }

  // GUARDRAIL CHECK: Never allow a Blocked or Inactive supplier
  if (new_supplier_id) {
    const supplier = await prisma.supplier.findUnique({
      where: { supplier_id: new_supplier_id },
    });
    if (supplier && (supplier.status === 'Blocked' || supplier.status === 'Inactive')) {
      return res.status(400).json({
        error: `GUARDRAIL VIOLATION: Supplier ${new_supplier_id} is ${supplier.status}. Blocked or Inactive suppliers can NEVER receive an order or be selected.`,
      });
    }
  }

  // Save snapshot of original decision in override record
  const originalSnapshot = JSON.stringify({
    route: requirement.route,
    decision: requirement.decision,
    supplier_id: requirement.supplier_id,
    po_unit_price: requirement.po_unit_price,
    group_value_inr: requirement.group_value_inr,
    clause: requirement.clause,
    reason: requirement.reason,
  });

  await prisma.override.create({
    data: {
      requirement_id: requirement.id,
      original_decision: originalSnapshot,
      new_route: new_route || requirement.route || '',
      new_supplier_id: new_supplier_id || requirement.supplier_id,
      new_price: new_price !== undefined ? parseFloat(new_price) : requirement.po_unit_price,
      new_value: new_value !== undefined ? parseFloat(new_value) : requirement.group_value_inr,
      comment,
      actor,
      role,
    },
  });

  // Update requirement with override
  const updated = await prisma.requirement.update({
    where: { id: requirement.id },
    data: {
      route: new_route || requirement.route,
      supplier_id: new_supplier_id || requirement.supplier_id,
      po_unit_price: new_price !== undefined ? parseFloat(new_price) : requirement.po_unit_price,
      group_value_inr: new_value !== undefined ? parseFloat(new_value) : requirement.group_value_inr,
      status: 'overridden',
      reason: `OVERRIDDEN: ${comment} (Original route was ${requirement.route})`,
    },
  });

  // Audit
  await logAuditEvent(
    'Requirement',
    requirement.id,
    'override',
    actor,
    role,
    { original: originalSnapshot, updated: { new_route, new_supplier_id, comment } }
  );

  return res.json({ message: 'Override applied successfully', requirement: updated });
});
