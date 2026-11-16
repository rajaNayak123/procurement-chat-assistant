import { PolicyDocument, PolicyRule } from './types.js';

export interface SetParamOperation {
  op: 'set_param';
  param: string;
  value: any;
  citation?: string;
}

export interface AddRuleOperation {
  op: 'add_rule';
  position?: number | 'start' | 'end';
  rule: PolicyRule;
  citation?: string;
}

export interface UpdateRuleOperation {
  op: 'update_rule';
  rule_id: string;
  changes: Partial<PolicyRule>;
  citation?: string;
}

export interface RemoveRuleOperation {
  op: 'remove_rule';
  rule_id: string;
  citation?: string;
}

export interface DisableRuleOperation {
  op: 'disable_rule';
  rule_id: string;
  citation?: string;
}

export interface ReorderRulesOperation {
  op: 'reorder';
  order: string[]; // list of rule ids
  citation?: string;
}

export type PolicyOperation =
  | SetParamOperation
  | AddRuleOperation
  | UpdateRuleOperation
  | RemoveRuleOperation
  | DisableRuleOperation
  | ReorderRulesOperation;

export interface PolicyChangeSet {
  change_set_id?: string;
  policy_id: string;
  base_version: string;
  target_version: string;
  effective_from: string;
  is_amendment: boolean; // true = minor increment (e.g. 5.0 to 5.1), false = major (6.0)
  operations: PolicyOperation[];
  citations: Array<{ operation_index: number; sentence: string }>;
  assumptions: string[];
}

export function applyChangeSet(basePolicy: PolicyDocument, changeSet: PolicyChangeSet): PolicyDocument {
  const newPolicy: PolicyDocument = JSON.parse(JSON.stringify(basePolicy));

  newPolicy.version = changeSet.target_version;
  newPolicy.effective_from = changeSet.effective_from;
  newPolicy.status = 'approved';

  for (const op of changeSet.operations) {
    switch (op.op) {
      case 'set_param': {
        // Support nested keys like "ranking.weights.frequency" or direct keys
        if (op.param.includes('.')) {
          const parts = op.param.split('.');
          let curr: any = newPolicy.params;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]]) curr[parts[i]] = {};
            curr = curr[parts[i]];
          }
          curr[parts[parts.length - 1]] = op.value;
        } else {
          newPolicy.params[op.param] = op.value;
        }
        break;
      }
      case 'add_rule': {
        const rule = op.rule;
        if (op.position === 'start' || op.position === 0) {
          newPolicy.rules.unshift(rule);
        } else if (typeof op.position === 'number' && op.position >= 0 && op.position < newPolicy.rules.length) {
          newPolicy.rules.splice(op.position, 0, rule);
        } else {
          newPolicy.rules.push(rule);
        }
        break;
      }
      case 'update_rule': {
        const idx = newPolicy.rules.findIndex((r) => r.id === op.rule_id);
        if (idx !== -1) {
          newPolicy.rules[idx] = { ...newPolicy.rules[idx], ...op.changes };
        }
        break;
      }
      case 'remove_rule': {
        newPolicy.rules = newPolicy.rules.filter((r) => r.id !== op.rule_id);
        break;
      }
      case 'disable_rule': {
        const rule = newPolicy.rules.find((r) => r.id === op.rule_id);
        if (rule) rule.enabled = false;
        break;
      }
      case 'reorder': {
        const ruleMap = new Map(newPolicy.rules.map((r) => [r.id, r]));
        const reordered: PolicyRule[] = [];
        for (const id of op.order) {
          if (ruleMap.has(id)) {
            reordered.push(ruleMap.get(id)!);
            ruleMap.delete(id);
          }
        }
        // Append any remaining
        for (const r of ruleMap.values()) {
          reordered.push(r);
        }
        newPolicy.rules = reordered;
        break;
      }
    }
  }

  return newPolicy;
}
