# Architecture & Policy Decisions Log (DECISIONS.md)

This document records ambiguities, edge cases, and architectural choices encountered in the Corvo Engineering PR-to-PO procurement engine.
Format: **Noticed / Decided / Why / Where in code / Effect**.

---

### Decision 1: Unknown Plant (e.g., PUN2)
* **Noticed**: PR batch line (e.g., PR-26-00173) requests plant `PUN2`, which is not in `plants.csv` (only PUN1 and CHK1 exist).
* **Decided**: Reject the row in batch processing with route `NOT_PROCESSED` and a clear reason naming valid plants (`PUN1`, `CHK1`). In chat intake, refuse invalid plant names and prompt the user with allowed plants.
* **Why**: Purchasing cannot route procurement commitments or delivery logistics to an unconfigured, non-existent plant code.
* **Where in code**: `packages/engine/src/validation.ts`, `apps/api/src/services/batch.service.ts`, `packages/engine/src/chat.ts`.
* **Effect**: Row is preserved in output CSV as `NOT_PROCESSED` without aborting batch; chat strictly guides requesters.

---

### Decision 2: Invalid Quantity (Zero, Negative, or Non-Numeric)
* **Noticed**: PR-26-00172 has quantity `0`. Quantities might also be negative or non-numeric strings.
* **Decided**: Mark line as `NOT_PROCESSED` with reason `"Quantity must be a positive number (> 0)"`. Reject 0 or negative quantities immediately during chat slot-filling.
* **Why**: Purchase requests cannot be fulfilled or valued for zero or negative items.
* **Where in code**: `packages/engine/src/validation.ts`, `apps/api/src/services/batch.service.ts`.
* **Effect**: Prevents divide-by-zero, invalid valuation, or zero-quantity purchase orders.

---

### Decision 3: Missing or Unparseable Dates vs Need-by Earlier Than Creation
* **Noticed**: Some dates may be blank or malformed. Additionally, a need-by date could theoretically precede the creation date.
* **Decided**: Missing or unparseable `created_at` or `need_by_date` results in `NOT_PROCESSED`. If both dates parse cleanly but `need_by_date < created_at`, the line is still processed for decision routing, but flagged with a warning (`"need_by_date precedes created_at"`).
* **Why**: Date comparison is crucial for 14-day clubbing and 7-day need-by windows. If missing, grouping is mathematically impossible. A retrospective need-by is procedurally strange but still requires procurement action.
* **Where in code**: `packages/engine/src/validation.ts`, `packages/engine/src/clubbing.ts`.
* **Effect**: Unparsable dates fail cleanly into `NOT_PROCESSED`; illogical dates proceed with visible buyer warning flags.

---

### Decision 4: Urgent in Description but Urgency Column is "Normal"
* **Noticed**: 8 lines in the dataset have strings like "urgent", "ASAP", or "breakdown" in the item description while the structured `urgency` column specifies `Normal`.
* **Decided**: The structured `urgency` field is authoritative for rule evaluation (e.g. Rule 5.3 Emergency PO). However, the engine attaches a warning flag: `"Text mentions urgent/ASAP but urgency flag is Normal"`. Chat intake detects urgent keywords and explicitly asks the user: *"Should I mark this as an Emergency?"* rather than silently defaulting.
* **Why**: Free-text notes often copy old descriptions without procurement authorization for emergency bypass. Buyer must see the mismatch to avoid unauthorized sole-sourcing.
* **Where in code**: `packages/engine/src/matching.ts`, `packages/engine/src/rules.ts`, `apps/api/src/services/chat.service.ts`.
* **Effect**: Prevents abuse of emergency thresholds while alerting the buyer in the decision card.

---

### Decision 5: Free-text Item Matching and Confidence Thresholds
* **Noticed**: 39 lines lack item codes, using informal abbreviations (`brg 6308 ZZ`, `hyd hose`, `pneu cylinder`), case differences, noise suffixes (`- urgent`, `for maintenance`), or brand hints (`hydrax`).
* **Decided**: Implement a deterministic hybrid normalizer: lowercase, strip punctuation and noise words, expand abbreviation dictionary (`brg` -> `bearing`, `hyd` -> `hydraulic`, `pneu` -> `pneumatic`, `rod` -> `electrode`, `ss` -> `stainless steel`, `"` -> `inch`), enforce numeric/part-number token agreement (e.g., 6205 can NEVER match 6308). Score candidate matches: High confidence (>=0.85) resolves; medium confidence (0.60 to 0.85) resolves to best candidate with flag `"verify match"`; low confidence (<0.60) routes to `NEW_ITEM_SOURCING`. Never invent an item code.
* **Why**: Part number mistakes in engineering parts cause catastrophic assembly issues. High confidence must be preserved.
* **Where in code**: `packages/engine/src/matching.ts`.
* **Effect**: Robust resolution of standard variations while safely isolating new or uncataloged items.

---

### Decision 6: New Items with Missing Estimated Price
* **Noticed**: New items without an item master code may arrive without a requester estimated unit price.
* **Decided**: Route to `NEW_ITEM_SOURCING`. Set requirement value to `0` (or empty) and attach warning flag `"estimate missing"`. Never suggest suppliers.
* **Why**: Sourcing must initiate an RFQ/RFP to discover pricing on the market even if the engineer did not provide a budget estimate.
* **Where in code**: `packages/engine/src/valuation.ts`, `packages/engine/src/rules.ts`.
* **Effect**: Requirement moves to buyer queue with an explicit notification to solicit quotes.

---

### Decision 7: Requester Estimated Price on Existing Catalog Items
* **Noticed**: Requester estimated unit price is populated on lines for cataloged items, sometimes deviating from standard or PO price.
* **Decided**: Per Policy 3.1, valuation ignores requester estimate for existing items, using: (a) usable contract rate, (b) most recent PO in last 365 days, or (c) standard price. If requester estimate differs by >30% from the valuation price, attach warning flag `"estimate differs >30% from valuation"`.
* **Why**: Requester estimates are subjective; policy valuation must reflect actual commercial history and contracted terms.
* **Where in code**: `packages/engine/src/valuation.ts`.
* **Effect**: Valuation remains deterministic while highlighting potential market drift or budget discrepancies.

---

### Decision 8: Multi-Line PRs Across Different Plants
* **Noticed**: Single PR numbers (e.g., PR-26-00165..168) contain lines intended for different plants (`PUN1` and `CHK1`).
* **Decided**: Plant is evaluated per line. Clubbing into requirements strictly groups by `(resolved_item_code, plant)`.
* **Why**: Deliveries, plant storage, and cost centers are localized to specific factories.
* **Where in code**: `packages/engine/src/clubbing.ts`.
* **Effect**: Cross-plant same-item PRs in the same week remain separate requirements.

---

### Decision 9: Clubbing Window Boundary Semantics ("Within 14 calendar days" & "Within 7 days")
* **Noticed**: Policy 2.1-2.3 defines clubbing across lines created within 14 calendar days and need-by within 7 days either side of first line.
* **Decided**:
  1. Sort candidate lines by `(created_at, pr_no, pr_line)`.
  2. Requirement anchor line is the earliest line.
  3. Compare calendar dates: `diff_in_calendar_days(line.created_at, anchor.created_at) <= 14`.
  4. Need-by check: `abs(diff_in_calendar_days(line.need_by_date, anchor.need_by_date)) <= 7`.
  5. A line joins the earliest existing requirement for which it qualifies; else it opens a new requirement.
  6. Urgency, requester, and department are ignored for clubbing. Any Emergency line elevates the whole requirement to Emergency.
* **Why**: Matches worked examples exactly (e.g. worked example 14 split 8 days apart into two requirements).
* **Where in code**: `packages/engine/src/clubbing.ts`.
* **Effect**: Deterministic requirement grouping that enforces anti-splitting policy.

---

### Decision 10: Capex Clubbing and Rule Ordering
* **Noticed**: Capex items (ITM-1069..1073 and free text like "eot crane 5 ton") can appear as multiple lines.
* **Decided**: Clubbing applies to Capex items per Policy 2.2 (no exemption is made). Capex rule 5.1 evaluates before contract and spot rules, routing always to `CAPEX_SOURCING` with flag `needs_capex_approval` and 5 supplier suggestions.
* **Why**: Capital expenditure requires board/executive financial approvals and structured competitive sourcing regardless of existing price agreements.
* **Where in code**: `packages/engine/src/rules.ts`, `packages/engine/src/clubbing.ts`.
* **Effect**: Capex is consolidated by plant and window, then forced into capital procurement workflow.

---

### Decision 11: Valuation Price vs PO Placement Price
* **Noticed**: In worked example 6, valuation is Rs 1,56,170 based on most recent PO price 21.19, while the PO itself is placed at the preferred supplier's reference price 21.59.
* **Decided**: Maintain two distinct fields on the requirement: `valuation_price` (used for threshold evaluation) and `po_unit_price` (contract rate or preferred supplier's reference price).
* **Why**: Valuation measures expected spend against policy limits; purchase orders must be placed at the specific awarded supplier's contracted or reference rate.
* **Where in code**: `packages/engine/src/valuation.ts`, `packages/engine/src/rules.ts`.
* **Effect**: Correct policy threshold triggering and accurate PO commitment values.

---

### Decision 12: Historical Window Edges
* **Noticed**: Policy mentions "in the last 365 days" and "in the 548 days".
* **Decided**: Historical lookback windows are evaluated strictly before the requirement date: `requirement_date - lookback_days <= po_date < requirement_date`. Contract start/end validity dates are inclusive on both ends (`start_date <= requirement_date <= end_date`).
* **Why**: POs created on the same day as the requirement represent concurrent or subsequent activity and must not cause causality loops.
* **Where in code**: `packages/engine/src/history.ts`, `packages/engine/src/contracts.ts`.
* **Effect**: Consistent, reproducible lookback calculations without off-by-one errors.

---

### Decision 13: Tie-Breakers for Equal PO Dates or Contract Rates
* **Noticed**: Worked example 11 has two POs on the same day (2026-04-10) with prices 40,929.88 and 41,415.60.
* **Decided**: When `po_date` is identical, the higher `po_number` string/integer is treated as more recent. For contracts with equal rates, tie-break by earlier `end_date`, then by `contract_id` ascending.
* **Why**: Matches worked example 11 where the higher price PO (higher po_number) was picked.
* **Where in code**: `packages/engine/src/history.ts`, `packages/engine/src/contracts.ts`.
* **Effect**: Exact reproduction of historical price lookups across runs.

---

### Decision 14: Contract with Blocked or Inactive Supplier
* **Noticed**: Contract RC-2026-005 belongs to supplier S004 (Metalink Alloys), who is Blocked.
* **Decided**: Per Policy 4.1, a contract only applies if the supplier is `Active` at evaluation time. A contract with a Blocked or Inactive supplier is disqualified from both routing and valuation.
* **Why**: Compliance prevents placing orders or anchoring prices to suspended or non-compliant vendors.
* **Where in code**: `packages/engine/src/contracts.ts`, `packages/engine/src/invariants.ts`.
* **Effect**: S004 contracts are rejected; the engine falls back to PO history or standard price.

---

### Decision 15: Contract Ceiling Consumption and Reprocessing Idempotency
* **Noticed**: Multiple requirements in a batch may compete for remaining contract ceiling (e.g. RC-2026-002 with 38k left, RC-2026-015 with 12k left).
* **Decided**: Simulated ceiling consumption starts from `baseline_consumed` (from register + previously approved workspace POs outside the current batch). In batch execution, requirements consume ceiling in chronological order of `requirement_date` (then line created_at). Only requirements that actually execute `CONTRACT_PO` consume ceiling. PDF-only contracts start at `consumed = 0`.
* **Why**: Batch reprocessing must be deterministic and idempotent without corrupting live DB ledgers during dry runs.
* **Where in code**: `packages/engine/src/contracts.ts`, `apps/api/src/services/batch.service.ts`.
* **Effect**: Guarantees identical batch output upon repeated dry runs.

---

### Decision 16: Emergency Request with Usable Contract
* **Noticed**: An emergency requirement arises for an item that has an active, usable contract with available ceiling.
* **Decided**: Rule 5.2 (Contract PO) evaluates before Rule 5.3 (Emergency PO). If a contract is usable, the route is `CONTRACT_PO`. If value > 5,00,000, emergency eligibility fails and it falls through to normal rules.
* **Why**: An existing rate contract provides the fastest, pre-negotiated legal vehicle to procure immediately.
* **Where in code**: `packages/engine/src/rules.ts`.
* **Effect**: Maximizes contract utilization before resorting to spot quotes.

---

### Decision 17: Scope of "Bought Recently from Active Supplier"
* **Noticed**: Rules 5.3 and 5.4 require "item bought from an Active supplier in the last 365 days".
* **Decided**: This check is plant-agnostic: if the item was purchased at any plant from a supplier that is currently Active, the condition passes.
* **Why**: Corporate buying power and vendor qualification are company-wide, not plant-isolated.
* **Where in code**: `packages/engine/src/history.ts`.
* **Effect**: Active supplier qualification spans all plants.

---

### Decision 18: Preferred Supplier with Contract but No PO History
* **Noticed**: A supplier may hold a valid contract for an item but has no PO recorded in the 548-day window.
* **Decided**: Supplier qualifies for preferred supplier ranking under Membership rule 6.1(b). Their reference price is taken from the contract rate.
* **Why**: Contract award represents formal commercial endorsement.
* **Where in code**: `packages/engine/src/ranking.ts`.
* **Effect**: Contract holders are automatically ranked even before initial dispatch.

---

### Decision 19: Sourcing Suggestions and Category Top-Up
* **Noticed**: An RFQ requires 3 suggested suppliers; RFP/Capex requires 5. Some items have fewer preferred suppliers.
* **Decided**: Sourcing suggestions first take the preferred supplier list. If fewer than target (3 or 5), top up with other Active suppliers who list the item's category in `supplier_master.csv`. Rank top-ups by `0.5 * (on_time_pct / 100) + 0.5 * (quality / 5)`, tie-break by lower `supplier_id`. If still fewer than target, return as many as exist (never pad with Blocked/Inactive). New items receive 0 suggestions.
* **Why**: Matches worked examples (e.g. crane returned 5, worked example 11 returned 4 of 5).
* **Where in code**: `packages/engine/src/ranking.ts`.
* **Effect**: High-quality compliant sourcing slates.

---

### Decision 20: PO Consolidation 24-Hour Anchor and Numbering
* **Noticed**: Requirements that result in POs must be consolidated into single purchase orders when matching supplier, plant, and route.
* **Decided**:
  1. Anchor = creation timestamp of the first requirement assigned to that PO.
  2. Window = `requirement.created_at <= anchor.created_at + 24 hours` (not a sliding window).
  3. Sourcing requests are never consolidated.
  4. Numbering is sequentially assigned (`PO-0001`, `PO-0002`...) as POs are opened.
  5. Different routes (e.g. SPOT_PO vs EMERGENCY_PO) do not merge even if same supplier and plant.
* **Why**: Prevents indefinite window stretching and groups orders for supplier fulfillment.
* **Where in code**: `packages/engine/src/consolidation.ts`.
* **Effect**: Accurate, predictable PO consolidation.

---

### Decision 21: Item Type "Services"
* **Noticed**: `item_master.csv` contains item types `Material`, `Service` (ITM-1061..1068), and `Capex` (ITM-1069..1073).
* **Decided**: Services are treated like Material unless an amendment introduces service-specific rules.
* **Why**: The default policy v5.0 defines no special clauses for Services.
* **Where in code**: `packages/engine/src/rules.ts`.
* **Effect**: Services follow contract, emergency, spot, RFQ, or RFP routes normally.

---

### Decision 22: Policy Version Selection per Requirement
* **Noticed**: Policy changes have an `effective_from` date. A PR batch may span dates before and after an effective date.
* **Decided**: By default, each requirement selects the latest policy version whose `effective_from <= requirement_date`. The decision record stores the `policy_version` used. An optional override parameter allows forcing a specific version for what-if simulation.
* **Why**: Ensures legal adherence to policies active on the date of requisition.
* **Where in code**: `packages/engine/src/engine.ts`, `apps/api/src/services/batch.service.ts`.
* **Effect**: Exact version attribution per line in output CSV.

---

### Decision 23: Ambiguous Amendment Handling
* **Noticed**: Unstructured natural language or uploaded policy amendments may be ambiguous.
* **Decided**: The policy extraction pipeline extracts a list of assumptions and citations alongside the structured JSON operations. The UI displays these assumptions as checkboxes that a Procurement Head must acknowledge before activation.
* **Why**: AI extractions must not silently adopt assumptions without human oversight.
* **Where in code**: `packages/policy/src/extractor.ts`, `apps/web/src/pages/PolicyPage.tsx`.
* **Effect**: Full auditability and safety in policy lifecycle.

---

### Decision 24: Closed Requirements and Late-Arriving PR Lines
* **Noticed**: A PR line might arrive after an existing requirement has been approved and locked.
* **Decided**: Approved requirements are immutable. New PR lines for the same item/plant initiate a new requirement with a reference flag: `"Related to closed REQ-XXXX"`.
* **Why**: Procurement commitments (POs/RFQs) already issued to vendors cannot be retroactively edited silently.
* **Where in code**: `apps/api/src/services/batch.service.ts`.
* **Effect**: Preserves integrity of historical purchase orders.

---

### Decision 25: Duplicate (pr_no, pr_line) Handling
* **Noticed**: Batches may contain duplicate `(pr_no, pr_line)` tuples.
* **Decided**: Within a single batch, subsequent duplicate rows are flagged `NOT_PROCESSED` with reason `"Duplicate pr_no and pr_line in batch"`. When re-uploading across batches in persistent mode, perform an upsert with change detection.
* **Why**: Avoids double-ordering within a file while allowing revisions over time.
* **Where in code**: `packages/engine/src/validation.ts`, `apps/api/src/services/batch.service.ts`.
* **Effect**: Safe handling of batch anomalies.

---

### Decision 26: Financial Rounding and Number Formats
* **Noticed**: Financial calculations involve fractional rupees and paise.
* **Decided**: All money calculations use `decimal.js` with exact 2 decimal places in CSV outputs (`12345.67`, no currency symbols, no commas). UI presents Indian numbering system (`Rs 1,23,456.78`).
* **Why**: Prevents JavaScript floating-point errors; adheres to strict CSV format specifications.
* **Where in code**: `packages/engine/src/valuation.ts`, `packages/engine/src/formatters.ts`.
* **Effect**: Clean data interchange and localized user experience.

---

### Decision 27: Timezone and Application Clock
* **Noticed**: Date comparisons depend on current date/time.
* **Decided**: Standardize application clock on Indian Standard Time (IST, UTC+5:30). Support configurable `APP_NOW` environment variable and request header for deterministic test runs.
* **Why**: Operations are in Bhosari and Chakan (Maharashtra, India); tests require frozen time.
* **Where in code**: `packages/engine/src/utils/clock.ts`.
* **Effect**: Deterministic time-dependent calculations across environments.

---

### Decision 28: NOT_PROCESSED CSV Output Structure
* **Noticed**: Section 9 requires invalid rows to output in the same 13-column CSV structure without crashing.
* **Decided**: For `NOT_PROCESSED` rows: `pr_no` and `pr_line` preserved, `decision`, `group_id`, `po_id`, `supplier_id`, `unit_price`, `group_value_inr`, `suggested_supplier_ids` left empty, `route = NOT_PROCESSED`, and `reason` populated with error detail.
* **Why**: Downstream auditing must reconcile every line from input to output.
* **Where in code**: `apps/api/src/services/export.service.ts`, `packages/engine/src/engine.ts`.
* **Effect**: 1-to-1 row count parity between input and output files.

---

### Decision 29: Invariant Check for Blocked / Inactive Suppliers
* **Noticed**: Scoring penalizes using Blocked or Inactive suppliers anywhere (PO, suggestions, overrides).
* **Decided**: Implement both a policy parameter filtering excluded statuses AND a hardcoded unconditional invariant validator in `packages/engine/src/invariants.ts`. If any decision, PO, or suggestion includes an inactive/blocked supplier, the invariant throws an immediate exception.
* **Why**: Failsafe compliance barrier against supplier fraud or regulatory violation.
* **Where in code**: `packages/engine/src/invariants.ts`.
* **Effect**: Impossible for blocked/inactive suppliers to slip through any engine pathway.

---

### Decision 30: Supplier Ranking Formula Calibration and Sensitivity
* **Noticed**: Section 5 provides the calibrated ranking formula.
* **Decided**: Compute:
  $$\text{score} = 0.30 \times \left(\frac{\text{POs}}{\max \text{POs}}\right) + 0.25 \times \text{recency} + 0.20 \times \text{held\_contract} + 0.15 \times \frac{\text{on\_time\_pct}}{100} + 0.10 \times \frac{\text{quality}}{5}$$
  with recency = 1.0 (<=90d), 0.5 (<=365d), 0.0 (>365d). Tie-breakers: most recent PO date desc, on-time pct desc, supplier ID asc.
  *Sensitivity*: $\pm 0.05$ weight changes do not destabilize the verified lists (ITM-1048, ITM-1036, ITM-1016) because frequency and contract status dominate score separation.
* **Why**: Reproduces worked examples 3, 9, 10, 11, 12, and PO supplier selections 2, 5, 6, 7, 8.
* **Where in code**: `packages/engine/src/ranking.ts`.
* **Effect**: Accurate, transparent preferred supplier lists.
