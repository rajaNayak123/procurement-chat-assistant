import { PolicyDocument } from './types.js';

export const DEFAULT_POLICY_V5: PolicyDocument = {
  policy_id: "CORVO-PROC-POL-04",
  version: "5.0",
  effective_from: "2026-04-01",
  status: "active",
  params: {
    club_created_within_days: 14,
    club_need_by_within_days: 7,
    recent_purchase_days: 365,
    price_lookback_days: 365,
    preferred_lookback_days: 548,
    consolidation_window_hours: 24,
    excluded_supplier_statuses: ["Blocked", "Inactive"],
    spot_limit: 200000,
    emergency_limit: 500000,
    rfp_threshold: 1000000,
    ranking: {
      weights: {
        frequency: 0.30,
        recency: 0.25,
        contract: 0.20,
        on_time: 0.15,
        quality: 0.10,
      },
      recency_tiers: [
        { max_days: 90, score: 1.0 },
        { max_days: 365, score: 0.5 },
      ],
      tie_breakers: ["last_po_date_desc", "on_time_desc", "supplier_id_asc"],
      min_on_time_pct: null,
      min_quality: null,
    },
    topup: {
      weights: { on_time: 0.5, quality: 0.5 },
      match: "category",
    },
  },
  rules: [
    {
      id: "5.1",
      name: "Capex",
      enabled: true,
      when: {
        all: [{ field: "item.type", op: "eq", value: "Capex" }],
      },
      then: {
        decision: "SOURCING_REQUEST",
        route: "CAPEX_SOURCING",
        suggest: 5,
        flags: ["needs_capex_approval"],
      },
    },
    {
      id: "5.2",
      name: "Contract",
      enabled: true,
      when: {
        all: [{ field: "contract.usable", op: "eq", value: true }],
      },
      then: {
        decision: "PO",
        route: "CONTRACT_PO",
        supplier: "contract",
        price: "contract_rate",
      },
    },
    {
      id: "5.3",
      name: "Emergency",
      enabled: true,
      when: {
        all: [
          { field: "req.emergency", op: "eq", value: true },
          { field: "req.value", op: "lte", value: { param: "emergency_limit" } },
          { field: "history.bought_from_active", args: { days: 365 }, op: "eq", value: true },
        ],
      },
      then: {
        decision: "PO",
        route: "EMERGENCY_PO",
        supplier: "preferred_1",
        price: "reference_price",
      },
    },
    {
      id: "5.4",
      name: "Spot",
      enabled: true,
      when: {
        all: [
          { field: "req.value", op: "lt", value: { param: "spot_limit" } },
          { field: "history.bought_from_active", args: { days: 365 }, op: "eq", value: true },
        ],
      },
      then: {
        decision: "PO",
        route: "SPOT_PO",
        supplier: "preferred_1",
        price: "reference_price",
      },
    },
    {
      id: "5.5",
      name: "RFQ",
      enabled: true,
      when: {
        all: [
          { field: "req.value", op: "lt", value: { param: "rfp_threshold" } },
        ],
      },
      then: {
        decision: "SOURCING_REQUEST",
        route: "RFQ",
        suggest: 3,
      },
    },
    {
      id: "5.6",
      name: "RFP",
      enabled: true,
      when: {
        all: [
          { field: "req.value", op: "gte", value: { param: "rfp_threshold" } },
        ],
      },
      then: {
        decision: "SOURCING_REQUEST",
        route: "RFP",
        suggest: 5,
      },
    },
  ],
};
