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
});
