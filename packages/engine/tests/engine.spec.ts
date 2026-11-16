import { describe, it, expect } from 'vitest';
import {
  ItemMatcher,
  clubPRLines,
  ContractTracker,
  computeRequirementValuation,
  computePreferredSuppliers,
  getSourcingSuggestions,
  consolidatePOs,
  assertNoBlockedOrInactiveSuppliers,
  runDecisionEngine,
  PRLineInput,
  EngineContext,
} from '../src/index.js';
import {
  SYNTHETIC_PLANTS,
  SYNTHETIC_ITEMS,
  SYNTHETIC_SUPPLIERS,
  SYNTHETIC_CONTRACTS,
  SYNTHETIC_CONTRACT_LINES,
  SYNTHETIC_PO_HISTORY,
} from './fixtures/synthetic.js';
import { DEFAULT_POLICY_V5 } from '@cantill/policy';

describe('Unit Tests: Engine Clauses and Components', () => {
  it('Clause 1.1: Matcher handles abbreviations, noise phrases, and avoids part-number mismatch', () => {
    const matcher = new ItemMatcher(SYNTHETIC_ITEMS);

    // Exact code match
    const match1 = matcher.match('SYN-ITM-01', '');
    expect(match1.resolved_item_code).toBe('SYN-ITM-01');
    expect(match1.match_method).toBe('code_exact');

    // Abbreviation & noise: "brg 6308 ZZ urgent for maintenance"
    const match2 = matcher.match(undefined, 'brg 6308 ZZ urgent for maintenance');
    expect(match2.resolved_item_code).toBe('SYN-ITM-01');
    expect(match2.is_new).toBe(false);

    // Part number conflict: "bearing 6205" should NOT match 6308
    const match3 = matcher.match(undefined, 'bearing 6205');
    expect(match3.resolved_item_code).toBe('NEW');
    expect(match3.is_new).toBe(true);

    // Completely new item
    const matchNew = matcher.match(undefined, 'Ultrasonic thickness sensor 5MHz');
    expect(matchNew.resolved_item_code).toBe('NEW');
    expect(matchNew.is_new).toBe(true);
  });

  it('Clause 2.1-2.3: Clubbing respects 14-day creation, 7-day need-by, plant separation, and NEW isolation', () => {
    const matcher = new ItemMatcher(SYNTHETIC_ITEMS);

    // Two lines within 14 days and need-by within 7 days -> should club
    const lines = [
      {
        pr_no: 'PR-100',
        pr_line: 1,
        created_at: '2026-11-01T10:00:00Z',
        calendar_created_date: '2026-11-01',
        requester: 'Alice',
        department: 'Mech',
        plant: 'SYN-P1',
        resolved_item_code: 'SYN-ITM-01',
        is_new: false,
        description: 'Ball Bearing 6308',
        quantity: 10,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-15',
        urgency: 'Normal' as const,
        match_method: 'code_exact' as const,
        match_confidence: 1.0,
        flags: [],
        raw_line: {} as any,
      },
      {
        pr_no: 'PR-101',
        pr_line: 1,
        created_at: '2026-11-05T10:00:00Z',
        calendar_created_date: '2026-11-05',
        requester: 'Bob',
        department: 'Maintenance',
        plant: 'SYN-P1',
        resolved_item_code: 'SYN-ITM-01',
        is_new: false,
        description: 'Ball Bearing 6308',
        quantity: 15,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-18', // 3 days difference from 11-15 -> joins!
        urgency: 'Emergency' as const, // Emergency propagates
        match_method: 'code_exact' as const,
        match_confidence: 1.0,
        flags: [],
        raw_line: {} as any,
      },
      {
        pr_no: 'PR-102',
        pr_line: 1,
        created_at: '2026-11-02T10:00:00Z',
        calendar_created_date: '2026-11-02',
        requester: 'Charlie',
        department: 'Operations',
        plant: 'SYN-P2', // Different plant -> must NOT join
        resolved_item_code: 'SYN-ITM-01',
        is_new: false,
        description: 'Ball Bearing 6308',
        quantity: 5,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-15',
        urgency: 'Normal' as const,
        match_method: 'code_exact' as const,
        match_confidence: 1.0,
        flags: [],
        raw_line: {} as any,
      },
    ];

    const requirements = clubPRLines(lines, SYNTHETIC_ITEMS, 14, 7);
    expect(requirements.length).toBe(2);

    const p1Req = requirements.find((r) => r.plant === 'SYN-P1')!;
    expect(p1Req.lines.length).toBe(2);
    expect(p1Req.total_quantity).toBe(25);
    expect(p1Req.is_emergency).toBe(true); // Emergency propagated

    const p2Req = requirements.find((r) => r.plant === 'SYN-P2')!;
    expect(p2Req.lines.length).toBe(1);
    expect(p2Req.total_quantity).toBe(5);
  });

  it('Clause 4: Contract tracker picks lowest rate with room and tracks ceiling exhaustion', () => {
    // SYN-RC-01 has rate 1350 but only 50,000 ceiling left.
    // SYN-RC-02 has rate 1400 and 500,000 ceiling left.
    const tracker = new ContractTracker(
      SYNTHETIC_CONTRACTS,
      SYNTHETIC_CONTRACT_LINES,
      SYNTHETIC_SUPPLIERS
    );

    // If quantity is 20: 20 * 1350 = 27,000 <= 50,000 -> RC-01 has room and is cheaper
    const applicableSmall = tracker.getApplicableContracts('SYN-ITM-01', '2026-11-10', 20);
    const bestSmall = tracker.selectBestContract(applicableSmall);
    expect(bestSmall?.contract.contract_id).toBe('SYN-RC-01');
    expect(bestSmall?.rate).toBe(1350);

    // If quantity is 50: 50 * 1350 = 67,500 > 50,000 -> RC-01 is out of room! RC-02 must be picked
    const applicableLarge = tracker.getApplicableContracts('SYN-ITM-01', '2026-11-10', 50);
    const bestLarge = tracker.selectBestContract(applicableLarge);
    expect(bestLarge?.contract.contract_id).toBe('SYN-RC-02');
    expect(bestLarge?.rate).toBe(1400);
  });

  it('Clause 5: Preferred supplier ranking accurately computes scores, weights, and tie-breakers', () => {
    const { preferred, excluded } = computePreferredSuppliers(
      'SYN-ITM-01',
      '2026-11-01',
      SYNTHETIC_SUPPLIERS,
      SYNTHETIC_PO_HISTORY,
      SYNTHETIC_CONTRACTS,
      SYNTHETIC_CONTRACT_LINES,
      DEFAULT_POLICY_V5
    );

    // Should rank SYN-SUP-101 and SYN-SUP-102
    expect(preferred.length).toBe(2);
    expect(preferred[0].supplier_id).toBe('SYN-SUP-101');
    expect(preferred[0].rank).toBe(1);
    expect(preferred[0].reference_price).toBe(1360); // from most recent PO
    expect(preferred[0].explanation).toContain('Ranked 1st');

    // Blocked/Inactive should be excluded
    const blockedExcl = excluded.find((e) => e.supplier.status === 'Blocked');
    if (blockedExcl) {
      expect(blockedExcl.reason).toContain('Blocked');
    }
  });

  it('Clause 7: PO consolidation combines qualifying orders under 24-hour anchor', () => {
    const dummyReqs: any[] = [
      {
        group_id: 'REQ-0001',
        plant: 'SYN-P1',
        earliest_created_at: '2026-11-01T08:00:00Z',
        group_value_inr: 10000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
      {
        group_id: 'REQ-0002',
        plant: 'SYN-P1',
        earliest_created_at: '2026-11-01T18:00:00Z', // 10 hours later -> within 24h of REQ-0001
        group_value_inr: 20000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
      {
        group_id: 'REQ-0003',
        plant: 'SYN-P1',
        earliest_created_at: '2026-11-03T09:00:00Z', // >24h later -> opens new PO
        group_value_inr: 15000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
    ];

    const { consolidatedPOs, updatedRequirements } = consolidatePOs(dummyReqs, 24);
    expect(consolidatedPOs.length).toBe(2);
    expect(consolidatedPOs[0].po_id).toBe('PO-0001');
    expect(consolidatedPOs[0].requirements.length).toBe(2);
    expect(consolidatedPOs[0].total_value).toBe(30000);
    expect(consolidatedPOs[1].po_id).toBe('PO-0002');
  });

  it('Invariant Check: Never allows Blocked or Inactive suppliers', () => {
    const invalidReq: any[] = [
      {
        group_id: 'REQ-BAD',
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-BLOCKED',
        },
      },
    ];

    expect(() => {
      assertNoBlockedOrInactiveSuppliers(invalidReq, SYNTHETIC_SUPPLIERS);
    }).toThrow(/INVARIANT VIOLATION/);
  });

  it('Full Engine Execution with synthetic batch produces exact 13-column output', () => {
    const testBatch: PRLineInput[] = [
      {
        pr_no: 'PR-TEST-01',
        pr_line: 1,
        created_at: '2026-11-05 09:00',
        requester: 'Test User',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Ball bearing 6308-ZZ',
        quantity: 10,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
      {
        pr_no: 'PR-TEST-02',
        pr_line: 1,
        created_at: '2026-11-05 10:00',
        requester: 'Test User',
        department: 'Safety',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-04',
        description: 'Safety gloves',
        quantity: 100,
        uom: 'PAIR',
        estimated_unit_price: 100,
        need_by_date: '2026-11-22',
        urgency: 'Normal',
      },
      {
        pr_no: 'PR-TEST-03',
        pr_line: 1,
        created_at: '2026-11-05 11:00',
        requester: 'Invalid Row User',
        department: 'Safety',
        plant: 'SYN-P-INVALID', // Invalid plant
        item_code: 'SYN-ITM-04',
        description: 'Safety gloves',
        quantity: 100,
        uom: 'PAIR',
        need_by_date: '2026-11-22',
        urgency: 'Normal',
      },
    ];

    const ctx: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: SYNTHETIC_ITEMS,
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: SYNTHETIC_PO_HISTORY,
      contracts: SYNTHETIC_CONTRACTS,
      contract_lines: SYNTHETIC_CONTRACT_LINES,
      policy_versions: [DEFAULT_POLICY_V5],
    };

    const res = runDecisionEngine(testBatch, ctx);
    expect(res.outputRows.length).toBe(3);

    // Row 1 should be CONTRACT_PO
    expect(res.outputRows[0].decision).toBe('PO');
    expect(res.outputRows[0].route).toBe('CONTRACT_PO');
    expect(res.outputRows[0].po_id).toBe('PO-0001');

    // Row 3 should be NOT_PROCESSED
    expect(res.outputRows[2].route).toBe('NOT_PROCESSED');
    expect(res.outputRows[2].decision).toBe('');
    expect(res.outputRows[2].reason).toContain('Invalid plant');
  });

  it('Clause 6.1-6.4: Supplier eligibility thresholds filter suppliers and list them under excluded', () => {
    const strictPolicy = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    strictPolicy.params.ranking.min_on_time_pct = 95; // Require 95% on-time
    strictPolicy.params.ranking.min_quality = 4.5;    // Require 4.5 quality

    const result = computePreferredSuppliers(
      'SYN-ITM-01',
      '2026-11-15',
      SYNTHETIC_SUPPLIERS,
      SYNTHETIC_PO_HISTORY,
      SYNTHETIC_CONTRACTS,
      SYNTHETIC_CONTRACT_LINES,
      strictPolicy
    );

    // In SYNTHETIC_SUPPLIERS:
    // SYN-SUP-102 is 88% on-time (below 95%) and 4.2 quality (below 4.5) -> must be excluded!
    const excludedS102 = result.excluded.find((e) => e.supplier.supplier_id === 'SYN-SUP-102');
    expect(excludedS102).toBeDefined();
    expect(excludedS102?.reason).toMatch(/below required minimum/);
    expect(result.preferred.some((p) => p.supplier_id === 'SYN-SUP-102')).toBe(false);

    // Top-up suggestions also respect the strict threshold
    const topupSuggestions = getSourcingSuggestions(
      SYNTHETIC_ITEMS[0],
      result.preferred,
      SYNTHETIC_SUPPLIERS,
      3,
      strictPolicy
    );
    expect(topupSuggestions).not.toContain('SYN-SUP-102');
  });

  it('Clubbing and consolidation evaluate version in force per line and anchor requirement regardless of policy array order', () => {
    const policyV5 = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    policyV5.version = '5.0';
    policyV5.effective_from = '2026-04-01';
    policyV5.params.club_created_within_days = 14;
    policyV5.params.consolidation_window_hours = 24;

    const policyV51 = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    policyV51.version = '5.1';
    policyV51.effective_from = '2026-11-10';
    policyV51.params.club_created_within_days = 5; // Tighter window after Nov 10
    policyV51.params.consolidation_window_hours = 48;

    const testBatch: PRLineInput[] = [
      {
        pr_no: 'PR-ORD-01',
        pr_line: 1,
        created_at: '2026-11-01 10:00',
        requester: 'Alice',
        department: 'Mech',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Ball bearing 6308-ZZ',
        quantity: 10,
        uom: 'NOS',
        need_by_date: '2026-11-15',
        urgency: 'Normal',
      },
      {
        pr_no: 'PR-ORD-02',
        pr_line: 1,
        created_at: '2026-11-08 10:00', // 7 days apart (clubs under v5.0's 14d, but >5d)
        requester: 'Bob',
        department: 'Mech',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Ball bearing 6308-ZZ',
        quantity: 15,
        uom: 'NOS',
        need_by_date: '2026-11-16',
        urgency: 'Normal',
      },
    ];

    // Run with [v5.0, v5.1]
    const ctxForward: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: SYNTHETIC_ITEMS,
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: SYNTHETIC_PO_HISTORY,
      contracts: SYNTHETIC_CONTRACTS,
      contract_lines: SYNTHETIC_CONTRACT_LINES,
      policy_versions: [policyV5, policyV51],
    };
    const resForward = runDecisionEngine(testBatch, ctxForward);

    // Run with [v5.1, v5.0] (reverse DB order)
    const ctxReverse: EngineContext = {
      ...ctxForward,
      policy_versions: [policyV51, policyV5],
    };
    const resReverse = runDecisionEngine(testBatch, ctxReverse);

    // Both must club lines on 2026-11-08 under v5.0 (since Nov 8 < Nov 10 effective date)
    expect(resForward.requirements.length).toBe(resReverse.requirements.length);
    expect(resForward.outputRows[0].group_id).toBe(resReverse.outputRows[0].group_id);
    expect(resForward.outputRows[1].group_id).toBe(resReverse.outputRows[1].group_id);
  });

  it('PO consolidation does not truncate hours: 24h30m exceeds window and creates separate PO', () => {
    const dummyReqs: any[] = [
      {
        group_id: 'REQ-0001',
        requirement_date: '2026-11-01',
        earliest_created_at: '2026-11-01T08:00:00Z',
        plant: 'SYN-P1',
        group_value_inr: 10000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
      {
        group_id: 'REQ-0002',
        requirement_date: '2026-11-02',
        // Exactly 24 hours and 30 minutes after REQ-0001 (diff = 24.5 hrs)
        earliest_created_at: '2026-11-02T08:30:00Z',
        plant: 'SYN-P1',
        group_value_inr: 20000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
      {
        group_id: 'REQ-0003',
        requirement_date: '2026-11-02',
        // 23 hours and 59 minutes after REQ-0001 (diff < 24 hrs)
        earliest_created_at: '2026-11-02T07:59:00Z',
        plant: 'SYN-P1',
        group_value_inr: 15000,
        decision: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier_id: 'SYN-SUP-101',
        },
      },
    ];

    const { consolidatedPOs, updatedRequirements } = consolidatePOs(dummyReqs, 24);
    // REQ-0001 and REQ-0003 consolidate into PO-0001. REQ-0002 (at 24h30m) opens PO-0002.
    expect(consolidatedPOs.length).toBe(2);
    expect(consolidatedPOs[0].po_id).toBe('PO-0001');
    expect(consolidatedPOs[0].requirements.map((r) => r.group_id)).toEqual(['REQ-0001', 'REQ-0003']);
    expect(consolidatedPOs[1].po_id).toBe('PO-0002');
    expect(consolidatedPOs[1].requirements.map((r) => r.group_id)).toEqual(['REQ-0002']);
  });

  it('Duplicate pr_no and pr_line: first row is processed, only second row is marked NOT_PROCESSED', () => {
    const duplicateBatch: PRLineInput[] = [
      {
        pr_no: 'PR-DUP-01',
        pr_line: 1,
        created_at: '2026-11-05 09:00',
        requester: 'Alice',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Ball bearing 6308-ZZ',
        quantity: 10,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
      {
        pr_no: 'PR-OTHER-01',
        pr_line: 1,
        created_at: '2026-11-05 09:30',
        requester: 'Bob',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-04',
        description: 'Safety gloves',
        quantity: 50,
        uom: 'PAIR',
        estimated_unit_price: 100,
        need_by_date: '2026-11-22',
        urgency: 'Normal',
      },
      {
        pr_no: 'PR-DUP-01', // Exact duplicate of row 0
        pr_line: 1,
        created_at: '2026-11-05 10:00',
        requester: 'Alice',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Ball bearing 6308-ZZ',
        quantity: 10,
        uom: 'NOS',
        estimated_unit_price: 1500,
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
    ];

    const ctx: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: SYNTHETIC_ITEMS,
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: SYNTHETIC_PO_HISTORY,
      contracts: SYNTHETIC_CONTRACTS,
      contract_lines: SYNTHETIC_CONTRACT_LINES,
      policy_versions: [DEFAULT_POLICY_V5],
    };

    const res = runDecisionEngine(duplicateBatch, ctx);

    // Row 0 should be PROCESSED and have a valid group_id & decision
    expect(res.outputRows[0].pr_no).toBe('PR-DUP-01');
    expect(res.outputRows[0].route).not.toBe('NOT_PROCESSED');
    expect(res.outputRows[0].group_id).toBeTruthy();

    // Row 1 should be PROCESSED
    expect(res.outputRows[1].pr_no).toBe('PR-OTHER-01');
    expect(res.outputRows[1].route).not.toBe('NOT_PROCESSED');

    // Row 2 should be NOT_PROCESSED with duplicate error reason
    expect(res.outputRows[2].pr_no).toBe('PR-DUP-01');
    expect(res.outputRows[2].route).toBe('NOT_PROCESSED');
    expect(res.outputRows[2].reason).toContain('Duplicate pr_no and pr_line');

    expect(res.summary.totalInputLines).toBe(3);
    expect(res.summary.processedLines).toBe(2);
    expect(res.summary.notProcessedLines).toBe(1);
  });

  it('Rules 5.3 & 5.4 use recent_purchase_days and honour args.days for bought_from_active', () => {
    // Synthetic item with a PO 400 days old from an active supplier
    // Under 365-day window, bought_from_active should be FALSE -> RFQ instead of SPOT_PO
    const oldPOBatch: PRLineInput[] = [
      {
        pr_no: 'PR-OLD-01',
        pr_line: 1,
        created_at: '2026-11-05 09:00',
        requester: 'Charlie',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-OLD',
        description: 'Special Sensor',
        quantity: 1,
        uom: 'NOS',
        estimated_unit_price: 50000, // Below spot limit 200,000
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
    ];

    const oldPOHistory = [
      {
        po_number: 'PO-OLD-001',
        po_line: 1,
        po_date: '2025-09-01', // >400 days before 2026-11-05
        supplier_id: 'SYN-SUP-101',
        supplier_name: 'Synthetic Bearings Ltd',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-OLD',
        description: 'Special Sensor',
        quantity: 1,
        unit_price: 50000,
        currency: 'INR',
        status: 'Closed',
      },
    ];

    const ctx: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: [
        ...SYNTHETIC_ITEMS,
        {
          item_code: 'SYN-ITM-OLD',
          description: 'Special Sensor',
          category: 'Instrumentation',
          item_type: 'Material',
          uom: 'NOS',
          standard_price: 50000,
        },
      ],
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: oldPOHistory,
      contracts: [],
      contract_lines: [],
      policy_versions: [DEFAULT_POLICY_V5],
    };

    const res = runDecisionEngine(oldPOBatch, ctx);
    // Since PO is 400 days old, bought_from_active_365 is FALSE -> cannot do SPOT_PO (Rule 5.4), routes to RFQ (Rule 5.5)
    expect(res.outputRows[0].route).toBe('RFQ');
  });

  it('Rule trace surfaces failing field, actual value, expected value, and operator', () => {
    const batch: PRLineInput[] = [
      {
        pr_no: 'PR-TRACE-01',
        pr_line: 1,
        created_at: '2026-11-05 09:00',
        requester: 'Alice',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-01',
        description: 'Deep groove ball bearing 6308 ZZ',
        quantity: 1,
        uom: 'NOS',
        estimated_unit_price: 250,
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
    ];

    const ctx: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: SYNTHETIC_ITEMS,
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: SYNTHETIC_PO_HISTORY,
      contracts: [],
      contract_lines: [],
      policy_versions: [DEFAULT_POLICY_V5],
    };

    const res = runDecisionEngine(batch, ctx);
    const req = res.requirements[0];
    expect(req).toBeDefined();
    expect(req.decision).toBeDefined();

    // Rule 5.1 is Capex (item.type eq 'Capex')
    const capexTrace = req.decision?.rule_trace.find((t) => t.rule_id === '5.1');
    expect(capexTrace).toBeDefined();
    expect(capexTrace?.matched).toBe(false);
    expect(capexTrace?.failing_field).toBe('item.type');
    expect(capexTrace?.actual_value).toBe('Material');
    expect(capexTrace?.operator).toBe('eq');
    expect(capexTrace?.expected_value).toBe('Capex');
    expect(capexTrace?.reason).toContain('item.type ("Material") eq "Capex"');
  });

  it('Flags like needs_capex_approval reach the decision and requirement', () => {
    const capexItem = {
      item_code: 'SYN-CAPEX-01',
      description: 'CNC Milling Machine Center',
      category: 'Machinery',
      item_type: 'Capex',
      uom: 'SET',
      standard_price: 1500000,
    };

    const batch: PRLineInput[] = [
      {
        pr_no: 'PR-CAPEX-01',
        pr_line: 1,
        created_at: '2026-11-05 09:00',
        requester: 'Alice',
        department: 'Production',
        plant: 'SYN-P1',
        item_code: 'SYN-CAPEX-01',
        description: 'CNC Milling Machine Center',
        quantity: 1,
        uom: 'SET',
        estimated_unit_price: 1500000,
        need_by_date: '2026-11-20',
        urgency: 'Normal',
      },
    ];

    const ctx: EngineContext = {
      plants: SYNTHETIC_PLANTS,
      items: [...SYNTHETIC_ITEMS, capexItem],
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: SYNTHETIC_PO_HISTORY,
      contracts: [],
      contract_lines: [],
      policy_versions: [DEFAULT_POLICY_V5],
    };

    const res = runDecisionEngine(batch, ctx);
    const req = res.requirements[0];
    expect(req.decision?.route).toBe('CAPEX_SOURCING');
    expect(req.decision?.flags).toContain('needs_capex_approval');
    expect(req.flags).toContain('needs_capex_approval');
  });

  it('Executes price strategies last_po and standard, and supplier strategy preferred_n', () => {
    const policyWithStrategies = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    // Insert custom rules testing last_po and standard price strategies
    policyWithStrategies.rules.unshift(
      {
        id: 'test-standard-price',
        name: 'Standard Price Test',
        enabled: true,
        when: {
          all: [{ field: 'plant', op: 'eq', value: 'P-STD' }],
        },
        then: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier: 'preferred_1',
          price: 'standard',
        },
      },
      {
        id: 'test-last-po-price',
        name: 'Last PO Price Test',
        enabled: true,
        when: {
          all: [{ field: 'plant', op: 'eq', value: 'P-LAST' }],
        },
        then: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier: 'preferred_1',
          price: 'last_po',
        },
      },
      {
        id: 'test-preferred-n',
        name: 'Preferred N Sourcing Test',
        enabled: true,
        when: {
          all: [{ field: 'plant', op: 'eq', value: 'P-PREF-N' }],
        },
        then: {
          decision: 'SOURCING_REQUEST',
          route: 'RFQ',
          supplier: 'preferred_n',
          suggest: 2,
        },
      }
    );

    const testItem = {
      item_code: 'SYN-ITM-STRAT',
      description: 'Test Strategy Bearing',
      category: 'Mechanical Spares',
      item_type: 'Material',
      uom: 'NOS',
      standard_price: 333,
    };

    const testHistory = [
      {
        po_number: 'PO-HIST-99',
        po_line: 1,
        po_date: '2026-11-01',
        supplier_id: 'SYN-SUP-101',
        supplier_name: 'Synthetic Bearings Ltd',
        plant: 'SYN-P1',
        item_code: 'SYN-ITM-STRAT',
        description: 'Test Strategy Bearing',
        quantity: 10,
        unit_price: 444,
        currency: 'INR',
        status: 'Closed',
      },
    ];

    const ctx: EngineContext = {
      plants: [
        ...SYNTHETIC_PLANTS,
        { plant: 'P-STD', name: 'Plant Std' },
        { plant: 'P-LAST', name: 'Plant Last' },
        { plant: 'P-PREF-N', name: 'Plant Pref N' },
      ],
      items: [...SYNTHETIC_ITEMS, testItem],
      suppliers: SYNTHETIC_SUPPLIERS,
      po_history: testHistory,
      contracts: [],
      contract_lines: [],
      policy_versions: [policyWithStrategies],
    };

    // 1. Test standard price
    const resStd = runDecisionEngine(
      [
        {
          pr_no: 'PR-S-01',
          pr_line: 1,
          created_at: '2026-11-05 09:00',
          requester: 'Alice',
          department: 'Production',
          plant: 'P-STD',
          item_code: 'SYN-ITM-STRAT',
          description: 'Test Strategy Bearing',
          quantity: 1,
          uom: 'NOS',
          need_by_date: '2026-11-20',
          urgency: 'Normal',
        },
      ],
      ctx
    );
    expect(resStd.requirements[0].decision?.po_unit_price).toBe(333); // standard price

    // 2. Test last_po price
    const resLast = runDecisionEngine(
      [
        {
          pr_no: 'PR-L-01',
          pr_line: 1,
          created_at: '2026-11-05 09:00',
          requester: 'Alice',
          department: 'Production',
          plant: 'P-LAST',
          item_code: 'SYN-ITM-STRAT',
          description: 'Test Strategy Bearing',
          quantity: 1,
          uom: 'NOS',
          need_by_date: '2026-11-20',
          urgency: 'Normal',
        },
      ],
      ctx
    );
    expect(resLast.requirements[0].decision?.po_unit_price).toBe(444); // last PO price

    // 3. Test preferred_n supplier strategy
    const resPrefN = runDecisionEngine(
      [
        {
          pr_no: 'PR-N-01',
          pr_line: 1,
          created_at: '2026-11-05 09:00',
          requester: 'Alice',
          department: 'Production',
          plant: 'P-PREF-N',
          item_code: 'SYN-ITM-STRAT',
          description: 'Test Strategy Bearing',
          quantity: 1,
          uom: 'NOS',
          need_by_date: '2026-11-20',
          urgency: 'Normal',
        },
      ],
      ctx
    );
    expect(resPrefN.requirements[0].decision?.route).toBe('RFQ');
    expect(resPrefN.requirements[0].decision?.suggested_supplier_ids.length).toBe(2);
  });
});
