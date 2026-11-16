import { z } from 'zod';

export type ComparisonOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'contains'
  | 'exists';

export type ValueOrParam =
  | string
  | number
  | boolean
  | Array<string | number>
  | { param: string };

export interface LeafPredicate {
  field: string;
  args?: Record<string, any>;
  op: ComparisonOperator;
  value?: ValueOrParam;
}

export interface PredicateGroup {
  all?: Predicate[];
  any?: Predicate[];
  not?: Predicate;
}

export type Predicate = LeafPredicate | PredicateGroup;

export interface RuleOutcome {
  decision: 'PO' | 'SOURCING_REQUEST';
  route: string;
  supplier?: 'contract' | 'preferred_1' | 'preferred_n' | 'none' | string;
  price?: 'contract_rate' | 'reference_price' | 'last_po' | 'standard' | string;
  suggest?: number;
  flags?: string[];
}

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  when: Predicate;
  then: RuleOutcome;
}

export interface RecencyTier {
  max_days: number;
  score: number;
}

export interface RankingParams {
  weights: {
    frequency: number;
    recency: number;
    contract: number;
    on_time: number;
    quality: number;
  };
  recency_tiers: RecencyTier[];
  tie_breakers: string[];
  min_on_time_pct: number | null;
  min_quality: number | null;
}

export interface TopupParams {
  weights: {
    on_time: number;
    quality: number;
  };
  match: string;
}

export interface PolicyParams {
  club_created_within_days: number;
  club_need_by_within_days: number;
  recent_purchase_days: number;
  price_lookback_days: number;
  preferred_lookback_days: number;
  consolidation_window_hours: number;
  excluded_supplier_statuses: string[];
  spot_limit: number;
  emergency_limit: number;
  rfp_threshold: number;
  ranking: RankingParams;
  topup: TopupParams;
  [key: string]: any;
}

export interface PolicyDocument {
  policy_id: string;
  version: string;
  effective_from: string; // YYYY-MM-DD
  status: 'draft' | 'pending_approval' | 'approved' | 'active' | 'superseded';
  params: PolicyParams;
  rules: PolicyRule[];
}

// Evaluation Context passed to evaluate predicates
export interface EvaluationContext {
  item: {
    code: string;
    description: string;
    category: string;
    type: string; // Material | Service | Capex
    uom: string;
    is_new: boolean;
    standard_price: number;
  };
  plant: string;
  req: {
    value: number;
    quantity: number;
    line_count: number;
    emergency: boolean;
    urgency: string; // Normal | Emergency
    department?: string;
    need_by_days_ahead: number;
  };
  contract: {
    exists: boolean;
    usable: boolean;
    ceiling_left: number;
    rate?: number;
    supplier_id?: string;
    contract_id?: string;
  };
  history: {
    bought_from_active_365: boolean;
    po_count_365: number;
    last_po_age_days: number | null;
    last_po_price: number | null;
  };
  supplier?: {
    preferred_1?: {
      id: string;
      on_time_pct: number;
      quality: number;
      reference_price: number;
    };
  };
}
