import {
  SupplierMaster,
  POHistoryRow,
  Contract,
  ContractLine,
  PreferredSupplierRank,
  ItemMaster,
} from './types.js';
import { PolicyDocument, RankingParams, TopupParams } from '@cantill/policy';
import { getCalendarDaysDiff } from './utils/dates.js';

export interface PreferredListResult {
  preferred: PreferredSupplierRank[];
  excluded: Array<{
    supplier: SupplierMaster;
    reason: string;
  }>;
}

export function computePreferredSuppliers(
  itemCode: string,
  asOfDate: string, // YYYY-MM-DD
  suppliers: SupplierMaster[],
  poHistory: POHistoryRow[],
  contracts: Contract[],
  contractLines: ContractLine[],
  policy?: PolicyDocument
): PreferredListResult {
  const code = itemCode.toUpperCase();
  const rankingParams: RankingParams = policy?.params?.ranking ?? {
    weights: {
      frequency: 0.3,
      recency: 0.25,
      contract: 0.2,
      on_time: 0.15,
      quality: 0.1,
    },
    recency_tiers: [
      { max_days: 90, score: 1.0 },
      { max_days: 365, score: 0.5 },
    ],
    tie_breakers: ['last_po_date_desc', 'on_time_desc', 'supplier_id_asc'],
    min_on_time_pct: null,
    min_quality: null,
  };

  const preferredLookback = policy?.params?.preferred_lookback_days ?? 548;

  // Contracts covering item
  const itemContractLines = contractLines.filter((l) => l.item_code.toUpperCase() === code);
  const contractMap = new Map<string, { contract: Contract; line: ContractLine }>();
  for (const cl of itemContractLines) {
    const c = contracts.find((con) => con.contract_id === cl.contract_id);
    if (c) {
      contractMap.set(c.contract_id, { contract: c, line: cl });
    }
  }

  // Find POs in 548 days window (strictly before asOfDate)
  const posIn548 = poHistory.filter((po) => {
    if (po.item_code.toUpperCase() !== code) return false;
    const diff = getCalendarDaysDiff(asOfDate, po.po_date);
    return diff > 0 && diff <= preferredLookback;
  });

  // Group POs by supplier
  const posBySupplier = new Map<string, POHistoryRow[]>();
  for (const po of posIn548) {
    const list = posBySupplier.get(po.supplier_id) || [];
    list.push(po);
    posBySupplier.set(po.supplier_id, list);
  }

  // Find contracts for this item by supplier (started on or before asOfDate)
  const contractsBySupplier = new Map<string, Array<{ contract: Contract; line: ContractLine }>>();
  for (const itemC of contractMap.values()) {
    const startDiff = getCalendarDaysDiff(asOfDate, itemC.contract.start_date);
    if (startDiff >= 0) {
      // Started on or before date
      const list = contractsBySupplier.get(itemC.contract.supplier_id) || [];
      list.push(itemC);
      contractsBySupplier.set(itemC.contract.supplier_id, list);
    }
  }

  const supplierMap = new Map(suppliers.map((s) => [s.supplier_id, s]));

  // All suppliers who have either (a) at least 1 PO in 548 days or (b) a contract covering item started on/before date
  const candidateSupplierIds = new Set<string>([
    ...posBySupplier.keys(),
    ...contractsBySupplier.keys(),
  ]);

  const rawPreferred: Array<{
    supplier: SupplierMaster;
    posInWindow: number;
    lastPo: POHistoryRow | null;
    lastPoAgeDays: number | null;
    recencyScore: number;
    heldContract: boolean;
    contractId: string | null;
    contractRate: number | null;
    referencePrice: number | null;
    referencePriceSource: 'po' | 'contract' | null;
    referencePriceRef: string | null;
  }> = [];

  const excluded: Array<{ supplier: SupplierMaster; reason: string }> = [];

  const excludedStatuses = new Set(
    policy?.params?.excluded_supplier_statuses ?? ['Blocked', 'Inactive']
  );
  const minOnTime = rankingParams.min_on_time_pct;
  const minQuality = rankingParams.min_quality;

  for (const sId of candidateSupplierIds) {
    const supplier = supplierMap.get(sId);
    if (!supplier) continue;

    // 1. Check status against excluded statuses
    if (excludedStatuses.has(supplier.status) || supplier.status !== 'Active') {
      excluded.push({
        supplier,
        reason: `Supplier status is ${supplier.status}`,
      });
      continue;
    }

    // 2. Check minimum on-time delivery threshold
    if (minOnTime !== null && minOnTime !== undefined && supplier.on_time_pct < minOnTime) {
      excluded.push({
        supplier,
        reason: `On-time rating ${supplier.on_time_pct}% is below required minimum ${minOnTime}%`,
      });
      continue;
    }

    // 3. Check minimum quality rating threshold
    if (minQuality !== null && minQuality !== undefined && supplier.quality_rating < minQuality) {
      excluded.push({
        supplier,
        reason: `Quality rating ${supplier.quality_rating} is below required minimum ${minQuality}`,
      });
      continue;
    }

    const supPOs = posBySupplier.get(sId) || [];
    const supContracts = contractsBySupplier.get(sId) || [];

    // Sort POs descending by date, then po_number descending
    supPOs.sort((a, b) => {
      const dDiff = getCalendarDaysDiff(b.po_date, a.po_date);
      if (dDiff !== 0) return dDiff;
      return b.po_number.localeCompare(a.po_number, undefined, { numeric: true });
    });

    const lastPo = supPOs[0] || null;
    const lastPoAgeDays = lastPo ? getCalendarDaysDiff(asOfDate, lastPo.po_date) : null;

    // Recency score
    let recencyScore = 0;
    if (lastPoAgeDays !== null) {
      for (const tier of rankingParams.recency_tiers) {
        if (lastPoAgeDays <= tier.max_days) {
          recencyScore = Math.max(recencyScore, tier.score);
        }
      }
    }

    // Held contract
    const heldContract = supContracts.length > 0;
    // Sort contracts by start_date desc to find most recent
    supContracts.sort((a, b) =>
      getCalendarDaysDiff(b.contract.start_date, a.contract.start_date)
    );
    const primaryContract = supContracts[0] || null;

    // Reference price: most recent PO price in 548 days, else contract rate
    let referencePrice: number | null = null;
    let referencePriceSource: 'po' | 'contract' | null = null;
    let referencePriceRef: string | null = null;

    if (lastPo) {
      referencePrice = lastPo.unit_price;
      referencePriceSource = 'po';
      referencePriceRef = lastPo.po_number;
    } else if (primaryContract) {
      referencePrice = primaryContract.line.rate;
      referencePriceSource = 'contract';
      referencePriceRef = primaryContract.contract.contract_id;
    }

    rawPreferred.push({
      supplier,
      posInWindow: supPOs.length,
      lastPo,
      lastPoAgeDays,
      recencyScore,
      heldContract,
      contractId: primaryContract?.contract.contract_id || null,
      contractRate: primaryContract?.line.rate || null,
      referencePrice,
      referencePriceSource,
      referencePriceRef,
    });
  }

  // Compute max POs in list
  const maxPOsInList = Math.max(1, ...rawPreferred.map((r) => r.posInWindow));
  const w = rankingParams.weights;

  // Calculate scores
  const scored = rawPreferred.map((item) => {
    const s = item.supplier;
    const weightedFreq = w.frequency * (item.posInWindow / maxPOsInList);
    const weightedRec = w.recency * item.recencyScore;
    const weightedCon = w.contract * (item.heldContract ? 1.0 : 0.0);
    const weightedOnTime = w.on_time * (s.on_time_pct / 100);
    const weightedQuality = w.quality * (s.quality_rating / 5);

    const totalScore = weightedFreq + weightedRec + weightedCon + weightedOnTime + weightedQuality;

    return {
      ...item,
      weighted_frequency: weightedFreq,
      weighted_recency: weightedRec,
      weighted_contract: weightedCon,
      weighted_on_time: weightedOnTime,
      weighted_quality: weightedQuality,
      total_score: totalScore,
    };
  });

  // Sort by total_score desc, then tie-breakers:
  // last_po_date_desc, on_time_desc, supplier_id_asc
  scored.sort((a, b) => {
    if (Math.abs(b.total_score - a.total_score) > 0.00001) {
      return b.total_score - a.total_score;
    }

    // Tie-breaker 1: more recent last PO
    const timeA = a.lastPo ? parseDateFlexible(a.lastPo.po_date).getTime() : 0;
    const timeB = b.lastPo ? parseDateFlexible(b.lastPo.po_date).getTime() : 0;
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    // Tie-breaker 2: higher on_time_pct
    if (b.supplier.on_time_pct !== a.supplier.on_time_pct) {
      return b.supplier.on_time_pct - a.supplier.on_time_pct;
    }

    // Tie-breaker 3: lower supplier_id
    return a.supplier.supplier_id.localeCompare(b.supplier.supplier_id);
  });

  // Assign ranks
  const preferred: PreferredSupplierRank[] = scored.map((item, index) => {
    const rank = index + 1;
    let explanation = `Ranked ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'}: `;
    explanation += `${item.posInWindow} POs, `;
    if (item.lastPoAgeDays !== null) {
      explanation += `bought ${item.lastPoAgeDays} days ago, `;
    } else {
      explanation += `no PO in window, `;
    }
    if (item.contractId) {
      explanation += `holds contract ${item.contractId}, `;
    }
    explanation += `${item.supplier.on_time_pct}% on time`;

    return {
      rank,
      supplier_id: item.supplier.supplier_id,
      supplier_name: item.supplier.name,
      status: item.supplier.status,
      pos_in_window: item.posInWindow,
      last_po_date: item.lastPo?.po_date || null,
      last_po_age_days: item.lastPoAgeDays,
      recency_score: item.recencyScore,
      held_contract: item.heldContract,
      contract_id: item.contractId,
      on_time_pct: item.supplier.on_time_pct,
      quality_rating: item.supplier.quality_rating,
      weighted_frequency: parseFloat(item.weighted_frequency.toFixed(4)),
      weighted_recency: parseFloat(item.weighted_recency.toFixed(4)),
      weighted_contract: parseFloat(item.weighted_contract.toFixed(4)),
      weighted_on_time: parseFloat(item.weighted_on_time.toFixed(4)),
      weighted_quality: parseFloat(item.weighted_quality.toFixed(4)),
      total_score: parseFloat(item.total_score.toFixed(4)),
      reference_price: item.referencePrice,
      reference_price_source: item.referencePriceSource,
      reference_price_ref: item.referencePriceRef,
      explanation,
    };
  });

  return { preferred, excluded };
}

function parseDateFlexible(val: string): Date {
  return new Date(val);
}

/**
 * Top up sourcing suggestions with other Active suppliers in the category
 */
export function getSourcingSuggestions(
  item: ItemMaster | undefined,
  preferredList: PreferredSupplierRank[],
  suppliers: SupplierMaster[],
  targetCount: number = 3,
  policy?: PolicyDocument
): string[] {
  // If item is new or undefined, 0 suggestions
  if (!item || item.item_code === 'NEW') {
    return [];
  }

  const suggestions: string[] = [];
  const addedSet = new Set<string>();

  // 1. Take preferred list in order
  for (const pref of preferredList) {
    if (suggestions.length >= targetCount) break;
    suggestions.push(pref.supplier_id);
    addedSet.add(pref.supplier_id);
  }

  if (suggestions.length >= targetCount) {
    return suggestions.slice(0, targetCount);
  }

  // 2. Sourcing top-up (Section 6.4): Active suppliers listing item's category meeting eligibility thresholds
  const itemCategory = item.category.trim().toLowerCase();
  const excludedStatuses = new Set(
    policy?.params?.excluded_supplier_statuses ?? ['Blocked', 'Inactive']
  );
  const minOnTime = policy?.params?.ranking?.min_on_time_pct;
  const minQuality = policy?.params?.ranking?.min_quality;

  const topupCandidates = suppliers.filter((s) => {
    if (excludedStatuses.has(s.status) || s.status !== 'Active') return false;
    if (minOnTime !== null && minOnTime !== undefined && s.on_time_pct < minOnTime) return false;
    if (minQuality !== null && minQuality !== undefined && s.quality_rating < minQuality) return false;
    if (addedSet.has(s.supplier_id)) return false;

    // Check if supplier categories contain item category
    return s.categories.some((cat) => cat.trim().toLowerCase() === itemCategory);
  });

  // Sort by policy topup weights (default: 0.5 * on_time/100 + 0.5 * quality/5), tie by supplier id
  const onTimeW = policy?.params?.topup?.weights?.on_time ?? 0.5;
  const qualityW = policy?.params?.topup?.weights?.quality ?? 0.5;

  topupCandidates.sort((a, b) => {
    const scoreA = onTimeW * (a.on_time_pct / 100) + qualityW * (a.quality_rating / 5);
    const scoreB = onTimeW * (b.on_time_pct / 100) + qualityW * (b.quality_rating / 5);
    if (Math.abs(scoreB - scoreA) > 0.0001) {
      return scoreB - scoreA;
    }
    return a.supplier_id.localeCompare(b.supplier_id);
  });

  for (const s of topupCandidates) {
    if (suggestions.length >= targetCount) break;
    suggestions.push(s.supplier_id);
    addedSet.add(s.supplier_id);
  }

  return suggestions;
}
