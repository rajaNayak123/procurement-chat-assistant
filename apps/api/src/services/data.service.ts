import { prisma } from '../prisma.js';
import {
  PlantMaster,
  ItemMaster,
  SupplierMaster,
  POHistoryRow,
  Contract,
  ContractLine,
  EngineContext,
} from '@cantill/engine';
import { PolicyDocument, DEFAULT_POLICY_V5 } from '@cantill/policy';

export async function loadEngineContext(forcedPolicyVersion?: string): Promise<EngineContext> {
  const [plantsDb, itemsDb, suppliersDb, poHistoryDb, contractsDb, contractLinesDb, policyVersionsDb, consumptionDb] =
    await Promise.all([
      prisma.plant.findMany(),
      prisma.item.findMany(),
      prisma.supplier.findMany(),
      prisma.pOHistory.findMany(),
      prisma.contract.findMany(),
      prisma.contractLine.findMany(),
      prisma.policyVersion.findMany({
        where: { status: { in: ['approved', 'active'] } },
      }),
      prisma.contractConsumption.findMany(),
    ]);

  const plants: PlantMaster[] = plantsDb.map((p) => ({
    plant: p.plant,
    name: p.name,
  }));

  const items: ItemMaster[] = itemsDb.map((i) => ({
    item_code: i.item_code,
    description: i.description,
    uom: i.uom,
    category: i.category,
    item_type: i.item_type,
    standard_price: i.standard_price,
  }));

  const suppliers: SupplierMaster[] = suppliersDb.map((s) => ({
    supplier_id: s.supplier_id,
    name: s.name,
    city: s.city,
    categories: s.categories.split(';').map((c) => c.trim()).filter(Boolean),
    status: s.status as any,
    on_time_pct: s.on_time_pct,
    quality_rating: s.quality_rating,
  }));

  const po_history: POHistoryRow[] = poHistoryDb.map((po) => ({
    po_number: po.po_number,
    po_date: po.po_date,
    supplier_id: po.supplier_id,
    item_code: po.item_code,
    quantity: po.quantity,
    uom: po.uom,
    unit_price: po.unit_price,
    plant: po.plant,
    delivered_on_time: po.delivered_on_time,
  }));

  const contracts: Contract[] = contractsDb.map((c) => ({
    contract_id: c.contract_id,
    supplier_id: c.supplier_id,
    supplier_name: c.supplier_name,
    start_date: c.start_date,
    end_date: c.end_date,
    value_cap: c.value_cap,
    consumed_value: c.consumed_value,
    source: c.source as any,
  }));

  const contract_lines: ContractLine[] = contractLinesDb.map((l) => ({
    contract_id: l.contract_id,
    item_code: l.item_code,
    description: l.description,
    uom: l.uom,
    rate: l.rate,
  }));

  let policy_versions: PolicyDocument[] = policyVersionsDb.map((pv) => {
    try {
      return JSON.parse(pv.policy_json);
    } catch {
      return DEFAULT_POLICY_V5;
    }
  });

  if (policy_versions.length === 0) {
    policy_versions = [DEFAULT_POLICY_V5];
  }

  // Build contract consumption ledger map from approved ledger entries
  const contract_ledger = new Map<string, number>();
  for (const entry of consumptionDb) {
    const current = contract_ledger.get(entry.contract_id) || 0;
    contract_ledger.set(entry.contract_id, current + entry.amount);
  }

  return {
    plants,
    items,
    suppliers,
    po_history,
    contracts,
    contract_lines,
    policy_versions,
    contract_ledger,
    force_policy_version: forcedPolicyVersion,
  };
}
