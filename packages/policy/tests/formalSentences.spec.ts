import { describe, it, expect } from 'vitest';
import { fallbackParseAmendment, DEFAULT_POLICY_V5 } from '../src/index.js';

describe('Formal Sentence Amendment Parser & Regression Tests', () => {
  it('parses: "The spot limit is raised from Rs 2,00,000 to Rs 3,00,000 with effect from 25 November 2026"', () => {
    const text = 'The spot limit is raised from Rs 2,00,000 to Rs 3,00,000 with effect from 25 November 2026';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'set_param',
      param: 'spot_limit',
      value: 300000,
      citation: text,
    });
    expect(changeSet.effective_from).toBe('2026-11-25');
  });

  it('parses: "Rule 5.3 is withdrawn"', () => {
    const text = 'Rule 5.3 is withdrawn';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'disable_rule',
      rule_id: '5.3',
      citation: text,
    });
  });

  it('parses: "The emergency limit shall be Rs 7,50,000 with effect from 2026-12-01"', () => {
    const text = 'The emergency limit shall be Rs 7,50,000 with effect from 2026-12-01';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'set_param',
      param: 'emergency_limit',
      value: 750000,
      citation: text,
    });
    expect(changeSet.effective_from).toBe('2026-12-01');
  });

  it('parses: "Clubbing window shall be 10 days"', () => {
    const text = 'Clubbing window shall be 10 days';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'set_param',
      param: 'club_created_within_days',
      value: 10,
      citation: text,
    });
  });

  it('parses: "Consolidation window is reduced from 24 hours to 12 hours"', () => {
    const text = 'Consolidation window is reduced from 24 hours to 12 hours';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'set_param',
      param: 'consolidation_window_hours',
      value: 12,
      citation: text,
    });
  });

  it('parses: "Minimum on-time percentage is raised from 80% to 90%"', () => {
    const text = 'Minimum on-time percentage is raised from 80% to 90%';
    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);

    expect(changeSet.operations.length).toBe(1);
    expect(changeSet.operations[0]).toEqual({
      op: 'set_param',
      param: 'ranking.min_on_time_pct',
      value: 90,
      citation: text,
    });
  });

  it('parses multi-sentence formal amendment containing multiple operations', () => {
    const text = `The spot limit is raised from Rs 2,00,000 to Rs 3,00,000 with effect from 25 November 2026.
Rule 5.3 is withdrawn.
Consolidation window shall be 48 hours.`;

    const changeSet = fallbackParseAmendment(text, DEFAULT_POLICY_V5);
    expect(changeSet.operations.length).toBe(3);
    expect(changeSet.effective_from).toBe('2026-11-25');
    expect(changeSet.operations[0].op).toBe('set_param');
    expect((changeSet.operations[0] as any).param).toBe('spot_limit');
    expect((changeSet.operations[0] as any).value).toBe(300000);
    expect(changeSet.operations[1].op).toBe('disable_rule');
    expect((changeSet.operations[1] as any).rule_id).toBe('5.3');
    expect(changeSet.operations[2].op).toBe('set_param');
    expect((changeSet.operations[2] as any).param).toBe('consolidation_window_hours');
    expect((changeSet.operations[2] as any).value).toBe(48);
  });

  it('fails loudly when zero operations are found and suggests form editor', () => {
    const nonPolicyText = 'This is an informal message with no policy amendments whatsoever.';
    expect(() => fallbackParseAmendment(nonPolicyText, DEFAULT_POLICY_V5)).toThrowError(
      /No policy operations could be extracted.*form editor/i
    );
  });
});
