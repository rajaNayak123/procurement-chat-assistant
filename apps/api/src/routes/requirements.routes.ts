import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { logAuditEvent } from '../services/audit.service.js';
import { loadEngineContext } from '../services/data.service.js';
import { computePreferredSuppliers, selectPolicyVersionForDate } from '@cantill/engine';

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

  // Fetch candidate contracts and preferred suppliers for explainability using requirement's policy
  const context = await loadEngineContext();
  const policy = selectPolicyVersionForDate(
    requirement.requirement_date,
    context.policy_versions,
    requirement.policy_version || undefined
  );
  const { preferred, excluded } = computePreferredSuppliers(
    requirement.item_code,
    requirement.requirement_date,
    context.suppliers,
    context.po_history,
    context.contracts,
    context.contract_lines,
    policy
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

  // STATE GUARDRAIL: Cannot re-approve already approved requirement
  if (requirement.status === 'approved') {
    return res.status(400).json({ error: 'STATE GUARDRAIL: Requirement is already approved and locked' });
  }

  // IDENTITY GUARDRAIL: Resolve identity from headers or body and enforce authorized roles
  const headerRole = req.headers['x-user-role'] as string | undefined;
  const headerActor = req.headers['x-user-name'] as string | undefined;
  const actor = headerActor || req.body.actor || 'Buyer Demo';
  const role = headerRole || req.body.role || 'Buyer';

  const ALLOWED_ROLES = ['Buyer', 'Procurement Head'];
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(403).json({
      error: `IDENTITY GUARDRAIL: Role "${role}" is not authorized. Requesters cannot approve requirements.`,
    });
  }

  // Capex requires approval by Procurement Head
  if (requirement.route === 'CAPEX_SOURCING' && role !== 'Procurement Head') {
    return res.status(403).json({
      error: 'IDENTITY GUARDRAIL: Capex requirements require approval from Procurement Head',
    });
  }

  const { comment = '' } = req.body;
  const isPO = requirement.decision === 'PO' || ['CONTRACT_PO', 'EMERGENCY_PO', 'SPOT_PO'].includes(requirement.route || '');

  // 1. If PO, create/update purchase_orders and po_lines rows
  if (isPO) {
    const poId = requirement.po_id || `PO-${requirement.group_id ? requirement.group_id.replace('REQ-', '') : String(Date.now()).slice(-4)}`;
    const poDbId = requirement.run_id ? `${requirement.run_id}_${poId}` : poId;

    await prisma.purchaseOrder.upsert({
      where: { id: poDbId },
      create: {
        id: poDbId,
        run_id: requirement.run_id,
        batch_id: requirement.batch_id,
        po_id: poId,
        supplier_id: requirement.supplier_id || '',
        plant: requirement.plant,
        route: requirement.route || 'SPOT_PO',
        total_value: requirement.group_value_inr,
        status: 'approved',
      },
      update: {
        status: 'approved',
        total_value: requirement.group_value_inr,
      },
    });

    // Create POLine rows for all PR lines belonging to this requirement
    const prLines = await prisma.pRLine.findMany({
      where: { requirement_id: requirement.id },
    });

    if (prLines.length > 0) {
      for (const line of prLines) {
        const unitPrice = requirement.po_unit_price || line.estimated_unit_price || 0;
        await prisma.pOLine.create({
          data: {
            po_id: poId,
            requirement_id: requirement.id,
            item_code: line.resolved_item_code,
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            unit_price: unitPrice,
            total_price: line.quantity * unitPrice,
          },
        });
      }
    } else {
      await prisma.pOLine.create({
        data: {
          po_id: poId,
          requirement_id: requirement.id,
          item_code: requirement.item_code,
          description: `Item ${requirement.item_code} for ${requirement.plant}`,
          quantity: requirement.total_quantity,
          uom: requirement.uom,
          unit_price: requirement.po_unit_price || requirement.valuation_price || 0,
          total_price: requirement.group_value_inr,
        },
      });
    }

    // If CONTRACT_PO, record ledger consumption using the exact contract_id from the decision!
    if (requirement.route === 'CONTRACT_PO') {
      const contractId = requirement.contract_id || requirement.valuation_ref;
      if (contractId) {
        await prisma.contractConsumption.create({
          data: {
            contract_id: contractId,
            po_id: poId,
            req_id: requirement.id,
            amount: requirement.group_value_inr,
          },
        });
        await prisma.contract.updateMany({
          where: { contract_id: contractId },
          data: {
            consumed_value: { increment: requirement.group_value_inr },
          },
        });
      }
    }
  } else {
    // 2. If Sourcing Request, create sourcing_requests row
    await prisma.sourcingRequest.create({
      data: {
        requirement_id: requirement.id,
        item_code: requirement.item_code,
        route: requirement.route || 'RFQ',
        estimated_value: requirement.group_value_inr,
        suggested_suppliers: requirement.suggested_suppliers || '',
        status: 'approved',
      },
    });
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
    { status: 'approved', comment, route: requirement.route, isPO }
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

  // STATE GUARDRAIL: Override cannot be performed on already approved and locked requirements
  if (requirement.status === 'approved') {
    return res.status(400).json({
      error: 'STATE GUARDRAIL VIOLATION: Requirement is already approved and locked. Overrides are not permitted.',
    });
  }

  // IDENTITY GUARDRAIL: Resolve identity from headers or body and enforce authorized roles
  const headerRole = req.headers['x-user-role'] as string | undefined;
  const headerActor = req.headers['x-user-name'] as string | undefined;
  const actor = headerActor || req.body.actor || 'Buyer Demo';
  const role = headerRole || req.body.role || 'Buyer';

  const ALLOWED_ROLES = ['Buyer', 'Procurement Head'];
  if (!ALLOWED_ROLES.includes(role)) {
    return res.status(403).json({
      error: `IDENTITY GUARDRAIL: Role "${role}" is not authorized. Requesters cannot override requirements.`,
    });
  }

  const {
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

  // SUPPLIER GUARDRAIL CHECK: Unknown suppliers or Blocked/Inactive suppliers are strictly rejected
  if (new_supplier_id) {
    const supplier = await prisma.supplier.findUnique({
      where: { supplier_id: new_supplier_id },
    });
    if (!supplier) {
      return res.status(400).json({
        error: `GUARDRAIL VIOLATION: Supplier "${new_supplier_id}" does not exist in master data.`,
      });
    }
    if (supplier.status === 'Blocked' || supplier.status === 'Inactive') {
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
    { comment, new_route, new_supplier_id, new_price, new_value }
  );

  return res.json({ message: 'Override applied successfully', requirement: updated });
});
