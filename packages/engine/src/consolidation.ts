import { Requirement, ConsolidatedPO } from './types.js';
import { getHoursDiff, parseDateFlexible } from './utils/dates.js';
import { PolicyDocument } from '@cantill/policy';
import { selectPolicyVersionForDate } from './utils/policySelector.js';

export function consolidatePOs(
  requirements: Requirement[],
  windowHoursOrPolicies: number | PolicyDocument[] = 24,
  forcedVersion?: string
): { consolidatedPOs: ConsolidatedPO[]; updatedRequirements: Requirement[] } {
  const updatedRequirements = [...requirements];
  const pos: ConsolidatedPO[] = [];
  let poCounter = 1;

  // Filter requirements that ended in a PO and have a supplier_id
  const poReqs = updatedRequirements.filter(
    (r) => r.decision?.decision === 'PO' && r.decision?.supplier_id
  );

  // Sort by earliest_created_at
  poReqs.sort((a, b) => {
    const timeA = parseDateFlexible(a.earliest_created_at).getTime();
    const timeB = parseDateFlexible(b.earliest_created_at).getTime();
    return timeA - timeB;
  });

  for (const req of poReqs) {
    const supplierId = req.decision!.supplier_id!;
    const plant = req.plant;
    const route = req.decision!.route;
    const reqCreatedAt = req.earliest_created_at;

    // Check if this requirement can join an existing open PO
    let joinedPO: ConsolidatedPO | null = null;

    for (const po of pos) {
      if (po.supplier_id !== supplierId) continue;
      if (po.plant !== plant) continue;
      if (po.route !== route) continue; // Route must match (e.g. Spot vs Emergency do not merge)

      // Window is determined by anchor requirement's policy version
      let consolidationWindowHours = 24;
      if (Array.isArray(windowHoursOrPolicies)) {
        const anchorPolicy = selectPolicyVersionForDate(
          po.requirements[0].requirement_date,
          windowHoursOrPolicies,
          forcedVersion
        );
        consolidationWindowHours = anchorPolicy.params.consolidation_window_hours ?? 24;
      } else {
        consolidationWindowHours = windowHoursOrPolicies;
      }

      // Measure from anchor requirement's created_at (not a sliding window)
      // Exact millisecond comparison so truncated hours don't allow requirements beyond window to join
      const diffMs =
        parseDateFlexible(reqCreatedAt).getTime() -
        parseDateFlexible(po.anchor_created_at).getTime();
      const maxWindowMs = consolidationWindowHours * 3_600_000;
      if (diffMs >= 0 && diffMs <= maxWindowMs) {
        joinedPO = po;
        break; // Joins earliest open PO it qualifies for
      }
    }

    if (joinedPO) {
      joinedPO.requirements.push(req);
      joinedPO.total_value += req.group_value_inr;
      req.decision!.po_id = joinedPO.po_id;
    } else {
      // Open new PO
      const poId = `PO-${String(poCounter++).padStart(4, '0')}`;
      const newPO: ConsolidatedPO = {
        po_id: poId,
        supplier_id: supplierId,
        plant,
        route,
        anchor_created_at: reqCreatedAt,
        requirements: [req],
        total_value: req.group_value_inr,
      };
      pos.push(newPO);
      req.decision!.po_id = poId;
    }
  }

  return { consolidatedPOs: pos, updatedRequirements };
}
