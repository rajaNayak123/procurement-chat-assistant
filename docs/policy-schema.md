# Corvo Engineering Policy-as-Data Schema Documentation

This document describes the JSON schema, operator language, field registry, and evaluation semantics governing the PR-to-PO procurement engine.

---

## 1. Top-Level Policy Document Structure

```json
{
  "policy_id": "CORVO-PROC-POL-04",
  "version": "5.0",
  "effective_from": "2026-04-01",
  "status": "active",
  "params": { ... },
  "rules": [ ... ]
}
```

* `policy_id` *(string)*: Unique procurement policy identifier.
* `version` *(string)*: Version identifier. Minor updates increment decimal (e.g., `5.0` &rarr; `5.1`); major replacements increment integer (e.g., `6.0`).
* `effective_from` *(string, YYYY-MM-DD)*: Requirement requisitions select the latest version where `effective_from <= requirement_date`.
* `status` *(string)*: One of `draft`, `pending_approval`, `approved`, `active`, `superseded`.
* `params` *(object)*: Numeric thresholds, windows, and ranking weights.
* `rules` *(array)*: Evaluated top-to-bottom. First matching rule determines route and outcome.

---

## 2. Policy Parameters (`params`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `club_created_within_days` | integer | `14` | Calendar days window from first line creation to club lines |
| `club_need_by_within_days` | integer | `7` | Maximum variance (either side) from first line's need-by date |
| `recent_purchase_days` | integer | `365` | Lookback window for recent purchase from active suppliers |
| `price_lookback_days` | integer | `365` | Lookback window for historical PO valuation price |
| `preferred_lookback_days` | integer | `548` | Lookback window for supplier ranking qualification |
| `consolidation_window_hours`| integer | `24` | Order consolidation anchor window (same supplier, plant, route) |
| `spot_limit` | number | `200000` | Value ceiling below which spot PO may be placed |
| `emergency_limit` | number | `500000` | Value ceiling for emergency PO placement |
| `rfp_threshold` | number | `1000000`| Value threshold at or above which RFP is mandatory |
| `excluded_supplier_statuses`| array | `["Blocked", "Inactive"]` | Prohibited supplier statuses |

---

## 3. Field Registry

The field registry maps condition fields to the evaluation context. Adding new fields requires mapping them in `packages/policy/src/evaluator.ts`.

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `item.code` | string | Normalized item catalog code (`ITM-1001` or `NEW`) |
| `item.description`| string | Normalized item description |
| `item.category` | string | Item category (e.g., `Fasteners`, `Bearings`, `Packaging`) |
| `item.type` | string | Item classification: `Material`, `Service`, `Capex` |
| `item.uom` | string | Unit of measurement (`NOS`, `PAIR`, `MTR`, `SET`) |
| `item.is_new` | boolean | `true` if item is uncataloged / new to procurement |
| `plant` | string | Plant code (`PUN1`, `CHK1`) |
| `req.value` | number | Calculated total requirement valuation (INR) |
| `req.quantity` | number | Sum of quantities across all clubbed lines |
| `req.line_count`| integer | Number of PR lines clubbed into this requirement |
| `req.emergency` | boolean | `true` if any line in requirement is marked Emergency |
| `req.urgency` | string | `Normal` or `Emergency` |
| `req.need_by_days_ahead`| integer | Days between requirement date and earliest need-by date |
| `contract.exists`| boolean | `true` if a rate contract covers this item on requirement date |
| `contract.usable`| boolean | `true` if active contract has sufficient ceiling remaining |
| `contract.ceiling_left`| number | Remaining currency ceiling on best usable contract |
| `history.bought_from_active` | boolean | `true` if bought from an Active vendor within lookback |
| `history.po_count` | integer | Number of POs in historical window |
| `history.last_po_age_days` | integer | Days since most recent historical PO |
| `supplier.preferred_1.on_time_pct` | number | On-time delivery percentage of 1st ranked preferred vendor |
| `supplier.preferred_1.quality` | number | Quality rating (1.0 to 5.0) of 1st ranked preferred vendor |

---

## 4. Operators

* `eq` / `ne`: Strict equality / inequality.
* `lt` / `lte` / `gt` / `gte`: Numeric comparison against literal or `{ "param": "name" }`.
* `in` / `not_in`: Array containment.
* `between`: Inclusive range `[min, max]`.
* `contains`: Substring match or array containment.
* `exists`: Null / undefined check.

---

## 5. Outcome Model

* `decision`: `"PO"` or `"SOURCING_REQUEST"`
* `route`: `"CONTRACT_PO"`, `"SPOT_PO"`, `"EMERGENCY_PO"`, `"RFQ"`, `"RFP"`, `"CAPEX_SOURCING"`, `"NEW_ITEM_SOURCING"` (or custom label)
* `supplier`: `"contract"`, `"preferred_1"`, `"preferred_n"`, or `"none"`
* `price`: `"contract_rate"`, `"reference_price"`, `"last_po"`, `"standard"`
* `suggest`: Integer number of suppliers to recommend (`3` for RFQ, `5` for RFP/Capex)
* `flags`: Workflow tags (e.g. `["needs_capex_approval"]`)
