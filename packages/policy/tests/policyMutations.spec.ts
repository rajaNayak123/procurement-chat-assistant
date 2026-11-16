import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLICY_V5,
  lintPolicy,
  renderRuleInPlainLanguage,
  renderPolicyInPlainLanguage,
  diffPolicies,
  applyChangeSet,
  fallbackParseAmendment,
  PolicyDocument,
} from '../src/index.js';

describe('Policy as Data: 8 Synthetic Amendments & Mutation Tests (Section 4.3 & 13.3)', () => {
  // 1. Limit Change
  it('Amendment 1: Limit Change (Spot limit to 300,000)', () => {
    const text = 'Change spot limit to 300000 from 25 Nov 2026.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0].op).toBe('set_param');

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updated.params.spot_limit).toBe(300000);
  });

  // 2. Category-specific Limit
  it('Amendment 2: Category-Specific Limit (Packaging spot limit to 3 lakh)', () => {
    const text = 'Raise the spot limit for Packaging to 3 lakh from 25 Nov';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0].op).toBe('add_rule');

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    const pkgRule = updated.rules.find((r) => r.name.includes('Packaging'))!;
    expect(pkgRule).toBeDefined();
    expect(pkgRule.when).toBeDefined();
  });

  // 3. Plant-only New Rule
  it('Amendment 3: Plant-Only New Rule (At CHK1, Lubricants below 3 lakh may be bought spot)', () => {
    const text = 'At CHK1, Lubricants below 3 lakh may be bought spot from 25 Nov 2026.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    const chk1Rule = updated.rules.find((r) => r.id.includes('chk1'))!;
    expect(chk1Rule).toBeDefined();
    expect(renderRuleInPlainLanguage(chk1Rule, updated)).toContain('plant is CHK1');
  });

  // 4. Window Changes
  it('Amendment 4: Window Changes (Clubbing 10 days, Consolidation 48 hours)', () => {
    const text = 'Change clubbing window to 10 days. Change consolidation window to 48 hours.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(2);

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updated.params.club_created_within_days).toBe(10);
    expect(updated.params.consolidation_window_hours).toBe(48);
  });

  // 5. New Emergency Condition
  it('Amendment 5: New Emergency Condition (Raise emergency limit to 7.5 lakh)', () => {
    const text = 'Raise emergency limit to 7.5 lakh from 2026-12-01.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updated.params.emergency_limit).toBe(750000);
  });

  // 6. Ranking Weights
  it('Amendment 6: Ranking Weights Change (Frequency weight to 0.40)', () => {
    const text = 'Change frequency weight to 0.40.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updated.params.ranking.weights.frequency).toBe(0.40);
  });

  // 7. Supplier Eligibility Threshold
  it('Amendment 7: Supplier Eligibility Threshold (Require minimum on-time of 90%)', () => {
    const text = 'Require minimum on-time of 90%.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(1);

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updated.params.ranking.min_on_time_pct).toBe(90);
  });

  // 8. Rule Removal / Disable
  it('Amendment 8: Rule Removal or Disable (Disable rule 5.1)', () => {
    const text = 'Disable rule 5.1.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations[0].op).toBe('disable_rule');

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    const rule51 = updated.rules.find((r) => r.id === '5.1')!;
    expect(rule51.enabled).toBe(false);
  });

  // Linter & Plain-language checks
  it('Linter validates policy structure and flags contradictory limits', () => {
    const invalid: PolicyDocument = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    invalid.params.spot_limit = 900000;
    invalid.params.emergency_limit = 500000; // contradictory!
    const issues = lintPolicy(invalid);
    expect(issues.some((i) => i.code === 'CONTRADICTORY_LIMITS')).toBe(true);
  });

  it('Plain-language renderer generates readable rule descriptions', () => {
    const rendered = renderPolicyInPlainLanguage(DEFAULT_POLICY_V5);
    expect(rendered.length).toBe(6);
    expect(rendered[0]).toContain('CAPEX_SOURCING');
  });
});
