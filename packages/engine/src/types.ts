import { PolicyDocument } from '@cantill/policy';

export interface PlantMaster {
  plant: string;
  name: string;
}

export interface ItemMaster {
  item_code: string;
  description: string;
  uom: string;
  category: string;
  item_type: 'Material' | 'Service' | 'Capex' | string;
  standard_price: number;
}

export interface SupplierMaster {
  supplier_id: string;
  name: string;
  city: string;
  categories: string[]; // split on ';'
  status: 'Active' | 'Blocked' | 'Inactive';
  on_time_pct: number;
  quality_rating: number;
}

export interface POHistoryRow {
  po_number: string;
  po_date: string; // YYYY-MM-DD
  supplier_id: string;
  item_code: string;
  quantity: number;
  uom: string;
  unit_price: number;
  plant: string;
  delivered_on_time: boolean;
}

export interface Contract {
  contract_id: string;
  supplier_id: string;
  supplier_name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  value_cap: number;
  consumed_value: number;
  source?: 'register' | 'pdf' | 'manual';
}

export interface ContractLine {
  contract_id: string;
  item_code: string;
  description: string;
  uom: string;
  rate: number;
}

export interface PRLineInput {
  pr_no: string;
  pr_line: number | string;
  created_at: string; // ISO string or YYYY-MM-DD HH:MM
  requester: string;
  department: string;
  plant: string;
  item_code?: string;
  description: string;
  quantity: number | string;
  uom: string;
  estimated_unit_price?: number | string | null;
  need_by_date: string;
  urgency: 'Normal' | 'Emergency' | string;
  [key: string]: any;
}

export interface ResolvedPRLine {
  input_index?: number;
  pr_no: string;
  pr_line: number;
  created_at: string;
  calendar_created_date: string; // YYYY-MM-DD
  requester: string;
  department: string;
  plant: string;
  input_item_code?: string;
  resolved_item_code: string; // Matched code or "NEW"
  is_new: boolean;
  description: string;
  quantity: number;
  uom: string;
  estimated_unit_price: number | null;
  need_by_date: string; // YYYY-MM-DD
  urgency: 'Normal' | 'Emergency';
  match_method: 'code_exact' | 'description_exact' | 'abbreviation' | 'token_fuzzy' | 'new_item';
  match_confidence: number;
  flags: string[];
  raw_line: PRLineInput;
}

export interface NotProcessedRow {
  input_index?: number;
  pr_no: string;
  pr_line: string | number;
  reason: string;
  raw_line: any;
}

export interface Requirement {
  group_id: string; // REQ-0001...
  item_code: string; // resolved code or "NEW"
  item_master?: ItemMaster;
  plant: string;
  requirement_date: string; // Date of first line (YYYY-MM-DD)
  earliest_created_at: string; // Timestamp of first line
  need_by_date: string; // need_by_date of first line
  lines: ResolvedPRLine[];
  total_quantity: number;
  uom: string;
  is_emergency: boolean;
  valuation_price: number;
  valuation_source: 'contract' | 'po_history' | 'standard_price' | 'requester_estimate' | 'missing';
  valuation_ref?: string; // contract id or po number relied upon
  contract_id?: string;
  group_value_inr: number; // total_quantity * valuation_price
  decision?: RequirementDecision;
}

export interface RequirementDecision {
  decision: 'PO' | 'SOURCING_REQUEST';
  route:
    | 'CONTRACT_PO'
    | 'EMERGENCY_PO'
    | 'SPOT_PO'
    | 'RFQ'
    | 'RFP'
    | 'CAPEX_SOURCING'
    | 'NEW_ITEM_SOURCING'
    | string;
  supplier_id?: string;
  contract_id?: string;
  po_unit_price?: number;
  suggested_supplier_ids: string[];
  policy_version: string;
  clause: string;
  reason: string;
  po_id?: string;
  rule_trace: Array<{
    rule_id: string;
    rule_name: string;
    matched: boolean;
    reason?: string;
  }>;
}

export interface ConsolidatedPO {
  po_id: string; // PO-0001...
  supplier_id: string;
  plant: string;
  route: string;
  anchor_created_at: string;
  requirements: Requirement[];
  total_value: number;
}

export interface PreferredSupplierRank {
  rank: number;
  supplier_id: string;
  supplier_name: string;
  status: 'Active' | 'Blocked' | 'Inactive';
  pos_in_window: number;
  last_po_date: string | null;
  last_po_age_days: number | null;
  recency_score: number;
  held_contract: boolean;
  contract_id: string | null;
  on_time_pct: number;
  quality_rating: number;
  weighted_frequency: number;
  weighted_recency: number;
  weighted_contract: number;
  weighted_on_time: number;
  weighted_quality: number;
  total_score: number;
  reference_price: number | null;
  reference_price_source: 'po' | 'contract' | null;
  reference_price_ref: string | null; // PO number or contract id
  explanation: string;
}

export interface DecisionOutputRow {
  pr_no: string;
  pr_line: number | string;
  resolved_item_code: string;
  group_id: string;
  po_id: string;
  decision: string;
  route: string;
  supplier_id: string;
  unit_price: string;
  group_value_inr: string;
  suggested_supplier_ids: string;
  policy_version: string;
  reason: string;
}

export interface EngineContext {
  plants: PlantMaster[];
  items: ItemMaster[];
  suppliers: SupplierMaster[];
  po_history: POHistoryRow[];
  contracts: Contract[];
  contract_lines: ContractLine[];
  policy_versions: PolicyDocument[]; // all versions to look up by effective_from
  contract_ledger?: Map<string, number>; // baseline consumed value from prior approved POs
  force_policy_version?: string; // what-if override
}
