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

describe('Policy as Data: Mutation and Amendment Tests', () => {
  it('(a) A limit change flips a route', () => {
    // Modify spot_limit from 200,000 to 50,000
    const amendedPolicy: PolicyDocument = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    amendedPolicy.params.spot_limit = 50000;

    const diff = diffPolicies(DEFAULT_POLICY_V5, amendedPolicy);
    expect(diff.paramChanges.length).toBe(1);
    expect(diff.paramChanges[0].param).toBe('spot_limit');
    expect(diff.paramChanges[0].oldValue).toBe(200000);
    expect(diff.paramChanges[0].newValue).toBe(50000);
  });

  it('(b) & (c) Plant-only and Category-only new rule added without code change', () => {
    const text = 'At CHK1, Lubricants below 3 lakh may be bought spot from 25 Nov 2026.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0].op).toBe('add_rule');

    const updatedPolicy = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updatedPolicy.rules.length).toBe(DEFAULT_POLICY_V5.rules.length + 1);

    const chk1Rule = updatedPolicy.rules.find((r) => r.id.includes('chk1'))!;
    expect(chk1Rule).toBeDefined();
    expect(chk1Rule.name).toContain('Lubricants');
    expect(renderRuleInPlainLanguage(chk1Rule, updatedPolicy)).toContain('plant is CHK1');
  });

  it('(d) Changed clubbing and consolidation windows via changeSet', () => {
    const text = 'Change clubbing window to 10 days. Change consolidation window to 48 hours.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(2);
    const updatedPolicy = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    expect(updatedPolicy.params.club_created_within_days).toBe(10);
    expect(updatedPolicy.params.consolidation_window_hours).toBe(48);
  });

  it('(e) Category-specific limit change via natural language', () => {
    const text = 'Raise the spot limit for Packaging to 3 lakh from 25 Nov';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    const updatedPolicy = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    const pkgRule = updatedPolicy.rules.find((r) => r.name.includes('Packaging'));
    expect(pkgRule).toBeDefined();
  });

  it('(f) Rule disable and remove operations', () => {
    const text = 'Disable rule 5.1.';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations[0].op).toBe('disable_rule');

    const updated = applyChangeSet(DEFAULT_POLICY_V5, changeSet);
    const rule51 = updated.rules.find((r) => r.id === '5.1')!;
    expect(rule51.enabled).toBe(false);
  });

  it('(g) Linter catches contradictory limits and missing effective date', () => {
    const invalidPolicy: PolicyDocument = JSON.parse(JSON.stringify(DEFAULT_POLICY_V5));
    invalidPolicy.params.spot_limit = 600000; // > emergency_limit (500000) -> contradictory!
    invalidPolicy.effective_from = ''; // missing

    const issues = lintPolicy(invalidPolicy);
    expect(issues.some((i) => i.code === 'CONTRADICTORY_LIMITS')).toBe(true);
    expect(issues.some((i) => i.code === 'MISSING_EFFECTIVE_DATE')).toBe(true);
  });

  it('(h) Plain-language renderer generates readable rule descriptions', () => {
    const rendered = renderPolicyInPlainLanguage(DEFAULT_POLICY_V5);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.some((r) => r.includes('CONTRACT_PO'))).toBe(true);
    expect(rendered.some((r) => r.includes('SPOT_PO'))).toBe(true);
  });
});
