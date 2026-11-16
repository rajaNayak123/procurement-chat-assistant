import Decimal from 'decimal.js';
import { Requirement, ItemMaster, POHistoryRow } from './types.js';
import { EvaluatedContract } from './contracts.js';
import { getMostRecentPO } from './history.js';

export interface ValuationResult {
  valuation_price: number;
  valuation_source: 'contract' | 'po_history' | 'standard_price' | 'requester_estimate' | 'missing';
  valuation_ref?: string;
  group_value_inr: number;
  flags: string[];
}

export function computeRequirementValuation(
  req: Requirement,
  itemMaster: ItemMaster | undefined,
  applicableContracts: EvaluatedContract[],
  bestUsableContract: EvaluatedContract | null,
  lowestApplicableContract: EvaluatedContract | null,
  poHistory: POHistoryRow[],
  priceLookbackDays: number = 365
): ValuationResult {
  const flags: string[] = [];
  const qty = new Decimal(req.total_quantity);

  // 1. If NEW item
  if (req.item_code === 'NEW' || !itemMaster) {
    const firstLineEst = req.lines[0]?.estimated_unit_price;
    if (firstLineEst !== null && firstLineEst !== undefined && firstLineEst > 0) {
      const price = new Decimal(firstLineEst);
      const totalVal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return {
        valuation_price: price.toNumber(),
        valuation_source: 'requester_estimate',
        group_value_inr: totalVal.toNumber(),
        flags,
      };
    } else {
      flags.push('estimate missing for new item');
      return {
        valuation_price: 0,
        valuation_source: 'missing',
        group_value_inr: 0,
        flags,
      };
    }
  }

  // 2. Existing item valuation hierarchy:
  // (a) Usable contract rate, or if every applicable contract is out of ceiling, lowest applicable contract rate
  let unitPrice: Decimal | null = null;
  let source: ValuationResult['valuation_source'] = 'missing';
  let ref: string | undefined = undefined;

  if (bestUsableContract) {
    unitPrice = new Decimal(bestUsableContract.rate);
    source = 'contract';
    ref = bestUsableContract.contract.contract_id;
  } else if (lowestApplicableContract) {
    unitPrice = new Decimal(lowestApplicableContract.rate);
    source = 'contract';
    ref = `${lowestApplicableContract.contract.contract_id} (out of ceiling)`;
  }

  // (b) Most recent PO in 365 days (any supplier, any status)
  if (!unitPrice) {
    const recentPO = getMostRecentPO(poHistory, req.item_code, req.requirement_date, priceLookbackDays);
    if (recentPO) {
      unitPrice = new Decimal(recentPO.unit_price);
      source = 'po_history';
      ref = `${recentPO.po_number} (${recentPO.po_date})`;
    }
  }

  // (c) Item master standard price
  if (!unitPrice) {
    unitPrice = new Decimal(itemMaster.standard_price);
    source = 'standard_price';
    ref = 'item_master';
  }

  const finalValuationPrice = unitPrice.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const groupValue = qty.times(finalValuationPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Check sanity flag: if requester estimate differs by >30% from valuation price
  for (const line of req.lines) {
    if (line.estimated_unit_price !== null && line.estimated_unit_price > 0) {
      const diffPct = Math.abs(line.estimated_unit_price - finalValuationPrice.toNumber()) / finalValuationPrice.toNumber();
      if (diffPct > 0.3) {
        flags.push(`estimate differs ${Math.round(diffPct * 100)}% from valuation`);
        break;
      }
    }
  }

  return {
    valuation_price: finalValuationPrice.toNumber(),
    valuation_source: source,
    valuation_ref: ref,
    group_value_inr: groupValue.toNumber(),
    flags,
  };
}
