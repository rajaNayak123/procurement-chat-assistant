import { PolicyDocument, PolicyRule, Predicate } from './types.js';
import { FIELD_REGISTRY } from './evaluator.js';

export interface LintIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  rule_id?: string;
}

export function lintPolicy(policy: PolicyDocument): LintIssue[] {
  const issues: LintIssue[] = [];

  // Check effective date
  if (!policy.effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(policy.effective_from)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_EFFECTIVE_DATE',
      message: 'Policy is missing a valid effective_from date (YYYY-MM-DD)',
    });
  }

  // Check contradictory limits
  if (
    typeof policy.params.spot_limit === 'number' &&
    typeof policy.params.emergency_limit === 'number' &&
    policy.params.spot_limit > policy.params.emergency_limit
  ) {
    issues.push({
      severity: 'error',
      code: 'CONTRADICTORY_LIMITS',
      message: `Contradictory limits: spot_limit (${policy.params.spot_limit}) is greater than emergency_limit (${policy.params.emergency_limit})`,
    });
  }

  if (
    typeof policy.params.spot_limit === 'number' &&
    typeof policy.params.rfp_threshold === 'number' &&
    policy.params.spot_limit > policy.params.rfp_threshold
  ) {
    issues.push({
      severity: 'error',
      code: 'CONTRADICTORY_LIMITS',
      message: `Contradictory limits: spot_limit (${policy.params.spot_limit}) is greater than rfp_threshold (${policy.params.rfp_threshold})`,
    });
  }

  // Check numeric parameter values
  const numericParams = [
    'club_created_within_days',
    'club_need_by_within_days',
    'recent_purchase_days',
    'price_lookback_days',
    'preferred_lookback_days',
    'consolidation_window_hours',
    'spot_limit',
    'emergency_limit',
    'rfp_threshold',
  ];
  for (const p of numericParams) {
    if (typeof policy.params[p] !== 'number' || isNaN(policy.params[p])) {
      issues.push({
        severity: 'error',
        code: 'NON_NUMERIC_PARAM',
        message: `Parameter ${p} must be a valid number, got ${typeof policy.params[p]}`,
      });
    }
  }

  // Check rules for unknown fields or params
  const enabledRules = policy.rules.filter((r) => r.enabled);
  let hasCatchAll = false;

  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    lintPredicate(rule.when, policy, rule.id, issues);

    // Check catch all
    if (isCatchAllPredicate(rule.when)) {
      hasCatchAll = true;
      if (i < policy.rules.length - 1 && policy.rules.slice(i + 1).some((r) => r.enabled)) {
        issues.push({
          severity: 'warning',
          code: 'SHADOWED_RULES',
          message: `Rule ${rule.id} is an unconditional catch-all; subsequent rules may be shadowed/unreachable`,
          rule_id: rule.id,
        });
      }
    }
  }

  // Check if at least one RFP or SOURCING catch-all exists
  const hasRfpOrCatchAll = enabledRules.some(
    (r) => r.then.route === 'RFP' || r.then.decision === 'SOURCING_REQUEST'
  );
  if (!hasRfpOrCatchAll) {
    issues.push({
      severity: 'warning',
      code: 'MISSING_CATCH_ALL',
      message: 'Policy may be missing a default fallback or RFP rule for high value requirements',
    });
  }

  return issues;
}

function lintPredicate(
  pred: Predicate,
  policy: PolicyDocument,
  ruleId: string,
  issues: LintIssue[]
): void {
  if ('field' in pred) {
    if (!FIELD_REGISTRY[pred.field]) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_FIELD',
        message: `Rule references unknown field "${pred.field}"`,
        rule_id: ruleId,
      });
    }
    if (
      pred.value &&
      typeof pred.value === 'object' &&
      'param' in pred.value &&
      !(pred.value.param in policy.params)
    ) {
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_PARAM',
        message: `Rule references non-existent parameter "${pred.value.param}"`,
        rule_id: ruleId,
      });
    }
    return;
  }

  if ('all' in pred && Array.isArray(pred.all)) {
    for (const child of pred.all) lintPredicate(child, policy, ruleId, issues);
  }
  if ('any' in pred && Array.isArray(pred.any)) {
    for (const child of pred.any) lintPredicate(child, policy, ruleId, issues);
  }
  if ('not' in pred && pred.not) {
    lintPredicate(pred.not, policy, ruleId, issues);
  }
}

function isCatchAllPredicate(pred: Predicate): boolean {
  if ('all' in pred && Array.isArray(pred.all) && pred.all.length === 0) return true;
  return false;
}
