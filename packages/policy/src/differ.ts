import { PolicyDocument, PolicyRule } from './types.js';
import { renderRuleInPlainLanguage, formatIndianCurrency } from './renderer.js';

export interface PolicyDiff {
  paramChanges: Array<{
    param: string;
    oldValue: any;
    newValue: any;
    description: string;
  }>;
  rulesAdded: PolicyRule[];
  rulesRemoved: PolicyRule[];
  rulesUpdated: Array<{
    ruleId: string;
    oldRule: PolicyRule;
    newRule: PolicyRule;
    changes: string[];
  }>;
  summaryLines: string[];
}

export function diffPolicies(oldPolicy: PolicyDocument, newPolicy: PolicyDocument): PolicyDiff {
  const diff: PolicyDiff = {
    paramChanges: [],
    rulesAdded: [],
    rulesRemoved: [],
    rulesUpdated: [],
    summaryLines: [],
  };

  // Compare params
  const allParamKeys = Array.from(
    new Set([...Object.keys(oldPolicy.params), ...Object.keys(newPolicy.params)])
  );

  for (const key of allParamKeys) {
    const oldVal = oldPolicy.params[key];
    const newVal = newPolicy.params[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      let desc = `Parameter "${key}" changed from ${JSON.stringify(oldVal)} to ${JSON.stringify(newVal)}`;
      if (typeof oldVal === 'number' && typeof newVal === 'number' && key.includes('limit')) {
        desc = `${key}: ${formatIndianCurrency(oldVal)} to ${formatIndianCurrency(newVal)}`;
      }
      diff.paramChanges.push({
        param: key,
        oldValue: oldVal,
        newValue: newVal,
        description: desc,
      });
      diff.summaryLines.push(desc);
    }
  }

  // Compare rules
  const oldRuleMap = new Map(oldPolicy.rules.map((r) => [r.id, r]));
  const newRuleMap = new Map(newPolicy.rules.map((r) => [r.id, r]));

  for (const [id, newRule] of newRuleMap.entries()) {
    if (!oldRuleMap.has(id)) {
      diff.rulesAdded.push(newRule);
      diff.summaryLines.push(`Added Rule ${id} (${newRule.name}): ${renderRuleInPlainLanguage(newRule, newPolicy)}`);
    } else {
      const oldRule = oldRuleMap.get(id)!;
      if (JSON.stringify(oldRule) !== JSON.stringify(newRule)) {
        const changes: string[] = [];
        if (oldRule.enabled !== newRule.enabled) {
          changes.push(`status changed from ${oldRule.enabled ? 'enabled' : 'disabled'} to ${newRule.enabled ? 'enabled' : 'disabled'}`);
        }
        if (JSON.stringify(oldRule.when) !== JSON.stringify(newRule.when)) {
          changes.push(`conditions changed`);
        }
        if (JSON.stringify(oldRule.then) !== JSON.stringify(newRule.then)) {
          changes.push(`outcome changed: route ${oldRule.then.route} -> ${newRule.then.route}`);
        }
        diff.rulesUpdated.push({
          ruleId: id,
          oldRule,
          newRule,
          changes,
        });
        diff.summaryLines.push(
          `Updated Rule ${id}: ${renderRuleInPlainLanguage(newRule, newPolicy)} (${changes.join(', ')})`
        );
      }
    }
  }

  for (const [id, oldRule] of oldRuleMap.entries()) {
    if (!newRuleMap.has(id)) {
      diff.rulesRemoved.push(oldRule);
      diff.summaryLines.push(`Removed Rule ${id} (${oldRule.name})`);
    }
  }

  return diff;
}
