import {
  PRLineInput,
  EngineContext,
  Requirement,
  ConsolidatedPO,
  NotProcessedRow,
  DecisionOutputRow,
  ItemMaster,
} from './types.js';
import { ItemMatcher } from './matching.js';
import { validateAndResolvePRBatch } from './validation.js';
import { clubPRLines } from './clubbing.js';
import { ContractTracker } from './contracts.js';
import { computeRequirementValuation } from './valuation.js';
import { computePreferredSuppliers } from './ranking.js';
import { evaluateRequirementRules } from './rules.js';
import { consolidatePOs } from './consolidation.js';
import { assertNoBlockedOrInactiveSuppliers } from './invariants.js';
import { DEFAULT_POLICY_V5, EvaluationContext, PolicyDocument } from '@cantill/policy';
import { getCalendarDaysDiff } from './utils/dates.js';

export interface EngineExecutionResult {
  requirements: Requirement[];
  consolidatedPOs: ConsolidatedPO[];
  notProcessed: NotProcessedRow[];
  outputRows: DecisionOutputRow[];
  summary: {
    totalInputLines: number;
    processedLines: number;
    notProcessedLines: number;
    totalRequirements: number;
    totalPOs: number;
    countsByRoute: Record<string, number>;
    policyVersionsUsed: string[];
    warnings: string[];
  };
}

export { selectPolicyVersionForDate } from './utils/policySelector.js';
import { selectPolicyVersionForDate } from './utils/policySelector.js';

export function runDecisionEngine(
  inputLines: PRLineInput[],
  context: EngineContext
): EngineExecutionResult {
  // Strictly sort policy versions by effective_from descending so array order never alters results
  const policies = (
    context.policy_versions && context.policy_versions.length > 0
      ? [...context.policy_versions]
      : [DEFAULT_POLICY_V5]
  ).sort((a, b) => getCalendarDaysDiff(b.effective_from, a.effective_from));

  const itemMap = new Map<string, ItemMaster>(
    context.items.map((i) => [i.item_code.toUpperCase(), i])
  );

  // 1. Item matching & validation
  const itemMatcher = new ItemMatcher(context.items);
  const { validLines, notProcessed } = validateAndResolvePRBatch(
    inputLines,
    context.plants,
    itemMatcher
  );

  // Map to preserve input order
  const notProcessedMap = new Map<string, NotProcessedRow>();
  for (const np of notProcessed) {
    notProcessedMap.set(`${np.pr_no}:${np.pr_line}`, np);
  }

  // 2. Clubbing: use the version in force at each line's date
  let requirements = clubPRLines(
    validLines,
    context.items,
    policies,
    7,
    context.force_policy_version
  );

  // 3. Sort requirements chronologically for simulated contract ceiling consumption
  requirements.sort((a, b) => {
    const diff = getCalendarDaysDiff(a.requirement_date, b.requirement_date);
    if (diff !== 0) return diff;
    return new Date(a.earliest_created_at).getTime() - new Date(b.earliest_created_at).getTime();
  });

  // 4. Contract tracker
  const contractTracker = new ContractTracker(
    context.contracts,
    context.contract_lines,
    context.suppliers,
    context.contract_ledger
  );

  const policyVersionsUsedSet = new Set<string>();
  const warnings: string[] = [];

  // 5. Evaluate each requirement
  for (const req of requirements) {
    // Select policy version active as of requirement date
    const policy = selectPolicyVersionForDate(
      req.requirement_date,
      policies,
      context.force_policy_version
    );
    policyVersionsUsedSet.add(policy.version);

    const item = itemMap.get(req.item_code.toUpperCase());

    // Evaluate contracts covering this item
    const applicableContracts = contractTracker.getApplicableContracts(
      req.item_code,
      req.requirement_date,
      req.total_quantity
    );
    const bestUsableContract = contractTracker.selectBestContract(applicableContracts);
    const lowestApplicableContract = contractTracker.getLowestApplicableRate(applicableContracts);

    // Compute valuation
    const valuation = computeRequirementValuation(
      req,
      item,
      applicableContracts,
      bestUsableContract,
      lowestApplicableContract,
      context.po_history,
      policy.params.price_lookback_days ?? 365
    );

    req.valuation_price = valuation.valuation_price;
    req.valuation_source = valuation.valuation_source;
    req.valuation_ref = valuation.valuation_ref;
    req.group_value_inr = valuation.group_value_inr;
    warnings.push(...valuation.flags.map((f) => `Req ${req.group_id}: ${f}`));

    // Preferred supplier list
    const { preferred } = computePreferredSuppliers(
      req.item_code,
      req.requirement_date,
      context.suppliers,
      context.po_history,
      context.contracts,
      context.contract_lines,
      policy
    );

    // Build EvaluationContext
    const lastPO = context.po_history
      .filter((p) => p.item_code.toUpperCase() === req.item_code.toUpperCase())
      .sort((a, b) => getCalendarDaysDiff(b.po_date, a.po_date))[0];

    const hasBoughtActive = preferred.some((p) => p.status === 'Active');

    const evalCtx: EvaluationContext = {
      item: {
        code: req.item_code,
        description: item?.description || req.lines[0]?.description || '',
        category: item?.category || '',
        type: item?.item_type || 'Material',
        uom: req.uom,
        is_new: req.item_code === 'NEW' || !item,
        standard_price: item?.standard_price || 0,
      },
      plant: req.plant,
      req: {
        value: req.group_value_inr,
        quantity: req.total_quantity,
        line_count: req.lines.length,
        emergency: req.is_emergency,
        urgency: req.is_emergency ? 'Emergency' : 'Normal',
        need_by_days_ahead: Math.max(0, getCalendarDaysDiff(req.need_by_date, req.requirement_date)),
      },
      contract: {
        exists: applicableContracts.length > 0,
        usable: bestUsableContract !== null,
        ceiling_left: bestUsableContract?.ceiling_left ?? 0,
        rate: bestUsableContract?.rate,
        supplier_id: bestUsableContract?.supplier.supplier_id,
        contract_id: bestUsableContract?.contract.contract_id,
      },
      history: {
        bought_from_active_365: hasBoughtActive,
        po_count_365: preferred.reduce((sum, p) => sum + p.pos_in_window, 0),
        last_po_age_days: preferred[0]?.last_po_age_days ?? null,
        last_po_price: preferred[0]?.reference_price ?? null,
      },
      supplier: {
        preferred_1: preferred[0]
          ? {
              id: preferred[0].supplier_id,
              on_time_pct: preferred[0].on_time_pct,
              quality: preferred[0].quality_rating,
              reference_price: preferred[0].reference_price ?? req.valuation_price,
            }
          : undefined,
      },
    };

    // Evaluate rules
    const decision = evaluateRequirementRules(
      req,
      evalCtx,
      policy,
      bestUsableContract,
      preferred,
      context.suppliers,
      item
    );
    req.decision = decision;

    // If decision takes CONTRACT_PO, record simulated ceiling consumption
    if (decision.decision === 'PO' && decision.route === 'CONTRACT_PO' && bestUsableContract) {
      const consumptionAmount = req.total_quantity * bestUsableContract.rate;
      contractTracker.recordConsumption(bestUsableContract.contract.contract_id, consumptionAmount);
    }
  }

  // 6. PO Consolidation: each open PO window is determined by its anchor requirement's policy version
  const { consolidatedPOs, updatedRequirements } = consolidatePOs(
    requirements,
    policies,
    context.force_policy_version
  );
  requirements = updatedRequirements;

  // 7. INVARIANT CHECK: Blocked or Inactive suppliers must NEVER receive a PO or be suggested
  assertNoBlockedOrInactiveSuppliers(requirements, context.suppliers);

  // 8. Generate exact 13-column output in input order
  // Create lookup for lines by (pr_no, pr_line)
  const lineToReqMap = new Map<string, { req: Requirement; line: any }>();
  for (const req of requirements) {
    for (const line of req.lines) {
      lineToReqMap.set(`${line.pr_no}:${line.pr_line}`, { req, line });
    }
  }

  const outputRows: DecisionOutputRow[] = [];
  const countsByRoute: Record<string, number> = {};

  for (const raw of inputLines) {
    const prNo = String(raw.pr_no || '').trim();
    const prLine = String(raw.pr_line || '').trim();
    const key = `${prNo}:${prLine}`;

    const np = notProcessedMap.get(key);
    if (np) {
      countsByRoute['NOT_PROCESSED'] = (countsByRoute['NOT_PROCESSED'] || 0) + 1;
      outputRows.push({
        pr_no: prNo,
        pr_line: prLine,
        resolved_item_code: '',
        group_id: '',
        po_id: '',
        decision: '',
        route: 'NOT_PROCESSED',
        supplier_id: '',
        unit_price: '',
        group_value_inr: '',
        suggested_supplier_ids: '',
        policy_version: '',
        reason: np.reason,
      });
      continue;
    }

    const matched = lineToReqMap.get(key);
    if (matched) {
      const { req, line } = matched;
      const dec = req.decision!;
      const route = dec.route;
      countsByRoute[route] = (countsByRoute[route] || 0) + 1;

      const isPO = dec.decision === 'PO';
      const unitPriceStr = isPO && dec.po_unit_price !== undefined ? dec.po_unit_price.toFixed(2) : '';
      const groupValStr = req.group_value_inr.toFixed(2);
      const suggestedStr = !isPO && dec.suggested_supplier_ids.length > 0 ? dec.suggested_supplier_ids.join(';') : '';

      outputRows.push({
        pr_no: prNo,
        pr_line: prLine,
        resolved_item_code: line.resolved_item_code,
        group_id: req.group_id,
        po_id: isPO && dec.po_id ? dec.po_id : '',
        decision: dec.decision,
        route: dec.route,
        supplier_id: isPO && dec.supplier_id ? dec.supplier_id : '',
        unit_price: unitPriceStr,
        group_value_inr: groupValStr,
        suggested_supplier_ids: suggestedStr,
        policy_version: dec.policy_version,
        reason: dec.reason,
      });
    }
  }

  return {
    requirements,
    consolidatedPOs,
    notProcessed,
    outputRows,
    summary: {
      totalInputLines: inputLines.length,
      processedLines: validLines.length,
      notProcessedLines: notProcessed.length,
      totalRequirements: requirements.length,
      totalPOs: consolidatedPOs.length,
      countsByRoute,
      policyVersionsUsed: Array.from(policyVersionsUsedSet),
      warnings,
    },
  };
}
