import {
  Requirement,
  RequirementDecision,
  SupplierMaster,
  ItemMaster,
  PreferredSupplierRank,
  POHistoryRow,
} from './types.js';
import { EvaluatedContract } from './contracts.js';
import {
  PolicyDocument,
  EvaluationContext,
  evaluatePredicate,
  extractFailingConditions,
  FailingCondition,
} from '@cantill/policy';
import { getSourcingSuggestions } from './ranking.js';
import { getMostRecentPO } from './history.js';

export function evaluateRequirementRules(
  req: Requirement,
  evalCtx: EvaluationContext,
  policy: PolicyDocument,
  bestContract: EvaluatedContract | null,
  preferredList: PreferredSupplierRank[],
  suppliers: SupplierMaster[],
  itemMaster?: ItemMaster,
  poHistory?: POHistoryRow[]
): RequirementDecision {
  // If item is NEW, policy rule 1.2 dictates NEW_ITEM_SOURCING
  if (req.item_code === 'NEW' || !itemMaster) {
    return {
      decision: 'SOURCING_REQUEST',
      route: 'NEW_ITEM_SOURCING',
      suggested_supplier_ids: [],
      policy_version: policy.version,
      clause: '1.2',
      reason: '1.2 New item: not in item master; routed to NEW_ITEM_SOURCING without supplier suggestions.',
      flags: ['new_item'],
      rule_trace: [
        {
          rule_id: '1.2',
          rule_name: 'New Item Sourcing',
          matched: true,
          reason: 'Item is not in catalog',
        },
      ],
    };
  }

  const ruleTrace: RequirementDecision['rule_trace'] = [];

  // Evaluate policy rules top-to-bottom
  for (const rule of policy.rules) {
    if (!rule.enabled) continue;

    const trace = evaluatePredicate(rule.when, evalCtx, policy);

    if (trace.matched) {
      ruleTrace.push({
        rule_id: rule.id,
        rule_name: rule.name,
        matched: true,
        reason: 'Conditions met',
      });
    } else {
      const failures = extractFailingConditions(trace);
      const firstFail = failures[0];
      const detailStr = failures
        .map((f: FailingCondition) => `${f.field} (${JSON.stringify(f.actual)}) ${f.op} ${JSON.stringify(f.expected)}`)
        .join('; ');
      ruleTrace.push({
        rule_id: rule.id,
        rule_name: rule.name,
        matched: false,
        reason: failures.length > 0 ? `Conditions not met: ${detailStr}` : 'Conditions not met',
        failing_field: firstFail?.field,
        actual_value: firstFail?.actual,
        expected_value: firstFail?.expected,
        operator: firstFail?.op,
      });
    }

    if (trace.matched) {
      // First match wins!
      const outcome = rule.then;
      let supplierId: string | undefined = undefined;
      let poUnitPrice: number | undefined = undefined;
      let suggestedSuppliers: string[] = [];
      const suggestCount = outcome.suggest ?? 3;

      // 1. Supplier Strategy
      if (outcome.supplier === 'contract') {
        supplierId = bestContract?.supplier.supplier_id;
      } else if (outcome.supplier === 'preferred_1') {
        supplierId = preferredList[0]?.supplier_id;
      } else if (outcome.supplier === 'preferred_n') {
        suggestedSuppliers = preferredList.slice(0, suggestCount).map((p) => p.supplier_id);
        if (suggestedSuppliers.length < suggestCount) {
          suggestedSuppliers = getSourcingSuggestions(
            itemMaster,
            preferredList,
            suppliers,
            suggestCount,
            policy
          );
        }
        if (outcome.decision === 'PO') {
          supplierId = preferredList[0]?.supplier_id;
        }
      } else if (outcome.supplier === 'none') {
        supplierId = undefined;
        suggestedSuppliers = [];
      } else {
        // Default
        if (outcome.decision === 'PO') {
          supplierId = preferredList[0]?.supplier_id;
        } else {
          suggestedSuppliers = getSourcingSuggestions(
            itemMaster,
            preferredList,
            suppliers,
            suggestCount,
            policy
          );
        }
      }

      // 2. Price Strategy
      if (outcome.price === 'contract_rate' || (!outcome.price && outcome.supplier === 'contract')) {
        poUnitPrice = bestContract?.rate ?? req.valuation_price;
      } else if (outcome.price === 'standard') {
        poUnitPrice = itemMaster?.standard_price ?? req.valuation_price;
      } else if (outcome.price === 'last_po') {
        let lastPrice: number | undefined;
        if (poHistory && poHistory.length > 0) {
          const recentPO = getMostRecentPO(
            poHistory,
            req.item_code,
            req.requirement_date,
            policy.params.price_lookback_days ?? 365
          );
          if (recentPO) {
            lastPrice = recentPO.unit_price;
          }
        }
        poUnitPrice = lastPrice ?? evalCtx.history.last_po_price ?? preferredList[0]?.reference_price ?? req.valuation_price;
      } else if (outcome.price === 'reference_price' || outcome.decision === 'PO') {
        poUnitPrice = preferredList[0]?.reference_price ?? req.valuation_price;
      }

      // If sourcing request and not preferred_n, ensure suggestedSuppliers is populated
      if (outcome.decision === 'SOURCING_REQUEST' && outcome.supplier !== 'preferred_n' && outcome.supplier !== 'none') {
        suggestedSuppliers = getSourcingSuggestions(
          itemMaster,
          preferredList,
          suppliers,
          suggestCount,
          policy
        );
      }

      // Build reason string (e.g. "5.4 SPOT_PO: value 1,26,472 < 2,00,000; bought in last 365d from Active supplier; ranked 1st of 4; reference price from PO 7300xxx (2026-10-12). Policy v5.0")
      let reason = `${rule.id} ${outcome.route}: `;
      if (outcome.route === 'CONTRACT_PO') {
        reason += `covered by active contract ${bestContract?.contract.contract_id} at rate ${bestContract?.rate}; remaining ceiling Rs ${bestContract?.ceiling_left.toFixed(2)}. Policy v${policy.version}.`;
      } else if (outcome.route === 'EMERGENCY_PO' || outcome.route === 'SPOT_PO') {
        const pref1 = preferredList[0];
        reason += `value Rs ${req.group_value_inr.toFixed(2)}; bought in last 365d from Active supplier; `;
        if (pref1) {
          reason += `placed with 1st preferred supplier ${pref1.supplier_id} (${pref1.supplier_name}) at reference price ${poUnitPrice} from ${pref1.reference_price_source === 'po' ? 'PO ' + pref1.reference_price_ref : 'contract ' + pref1.reference_price_ref}. `;
        }
        reason += `Policy v${policy.version}.`;
      } else {
        reason += `value Rs ${req.group_value_inr.toFixed(2)}; ${suggestedSuppliers.length} suppliers suggested. Policy v${policy.version}.`;
      }

      if (outcome.flags && outcome.flags.length > 0) {
        reason += ` [Flags: ${outcome.flags.join(', ')}]`;
      }

      return {
        decision: outcome.decision,
        route: outcome.route,
        supplier_id: supplierId,
        contract_id: outcome.route === 'CONTRACT_PO' ? bestContract?.contract.contract_id : undefined,
        po_unit_price: poUnitPrice,
        suggested_supplier_ids: suggestedSuppliers,
        policy_version: policy.version,
        clause: rule.id,
        reason,
        flags: outcome.flags ? [...outcome.flags] : [],
        rule_trace: ruleTrace,
      };
    }
  }

  // Fallback catch-all if no rule matched
  const suggested = getSourcingSuggestions(itemMaster, preferredList, suppliers, 3, policy);
  return {
    decision: 'SOURCING_REQUEST',
    route: 'RFQ',
    suggested_supplier_ids: suggested,
    policy_version: policy.version,
    clause: 'fallback',
    reason: `Fallback RFQ: no specific rule matched for value Rs ${req.group_value_inr}. Policy v${policy.version}.`,
    flags: [],
    rule_trace: ruleTrace,
  };
}
