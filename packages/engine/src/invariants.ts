import { Requirement, SupplierMaster } from './types.js';

export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(`INVARIANT VIOLATION: ${message}`);
    this.name = 'InvariantViolationError';
  }
}

export function assertNoBlockedOrInactiveSuppliers(
  requirements: Requirement[],
  suppliers: SupplierMaster[]
): void {
  const invalidSupplierMap = new Map<string, string>();
  for (const s of suppliers) {
    if (s.status === 'Blocked' || s.status === 'Inactive') {
      invalidSupplierMap.set(s.supplier_id, s.status);
    }
  }

  for (const req of requirements) {
    const decision = req.decision;
    if (!decision) continue;

    // Check PO supplier
    if (decision.decision === 'PO' && decision.supplier_id) {
      const status = invalidSupplierMap.get(decision.supplier_id);
      if (status) {
        throw new InvariantViolationError(
          `Requirement ${req.group_id} placed PO with ${status} supplier ${decision.supplier_id}!`
        );
      }
    }

    // Check sourcing suggestions
    if (decision.suggested_supplier_ids && decision.suggested_supplier_ids.length > 0) {
      for (const sId of decision.suggested_supplier_ids) {
        const status = invalidSupplierMap.get(sId);
        if (status) {
          throw new InvariantViolationError(
            `Requirement ${req.group_id} suggested ${status} supplier ${sId}!`
          );
        }
      }
    }
  }
}
