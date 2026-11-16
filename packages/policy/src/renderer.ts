import { PolicyDocument, PolicyRule, Predicate, ComparisonOperator } from './types.js';
import { resolveValue } from './evaluator.js';

export function formatIndianCurrency(num: number): string {
  const parts = num.toString().split('.');
  let lastThree = parts[0].substring(parts[0].length - 3);
  const otherNumbers = parts[0].substring(0, parts[0].length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return parts.length > 1 ? `Rs ${res}.${parts[1]}` : `Rs ${res}`;
}

export function operatorToText(op: ComparisonOperator): string {
  switch (op) {
    case 'eq': return 'is';
    case 'ne': return 'is not';
    case 'gt': return '>';
    case 'gte': return '>=';
    case 'lt': return '<';
    case 'lte': return '<=';
    case 'in': return 'in';
    case 'not_in': return 'not in';
    case 'between': return 'between';
    case 'contains': return 'contains';
    case 'exists': return 'exists';
  }
}

export function predicateToText(pred: Predicate, policy: PolicyDocument): string {
  if ('field' in pred) {
    const val = resolveValue(pred.value, policy);
    let valStr = String(val);
    if (typeof val === 'number' && pred.field.includes('value')) {
      valStr = formatIndianCurrency(val);
    }
    if (pred.field === 'item.type') {
      return `item type is ${val}`;
    }
    if (pred.field === 'plant') {
      return `plant is ${val}`;
    }
    if (pred.field === 'item.category') {
      return `category is ${val}`;
    }
    if (pred.field === 'req.value') {
      return `requirement value ${operatorToText(pred.op)} ${valStr}`;
    }
    if (pred.field === 'req.emergency') {
      return pred.op === 'eq' && val === true ? 'is emergency' : 'is not emergency';
    }
    if (pred.field === 'contract.usable') {
      return pred.op === 'eq' && val === true ? 'a contract can be used' : 'no contract usable';
    }
    if (pred.field === 'history.bought_from_active') {
      const days = pred.args?.days ?? 365;
      return `item was bought from an Active supplier in the last ${days} days`;
    }
    return `${pred.field} ${operatorToText(pred.op)} ${valStr}`;
  }

  if ('all' in pred && Array.isArray(pred.all)) {
    return pred.all.map((p) => predicateToText(p, policy)).join(' and ');
  }

  if ('any' in pred && Array.isArray(pred.any)) {
    return '(' + pred.any.map((p) => predicateToText(p, policy)).join(' or ') + ')';
  }

  if ('not' in pred && pred.not) {
    return `not (${predicateToText(pred.not, policy)})`;
  }

  return 'always';
}

export function ruleOutcomeToText(rule: PolicyRule): string {
  const then = rule.then;
  if (then.decision === 'PO') {
    const sup =
      then.supplier === 'contract'
        ? 'contract supplier'
        : then.supplier === 'preferred_1'
        ? '1st preferred supplier'
        : then.supplier || 'supplier';
    const prc =
      then.price === 'contract_rate'
        ? 'at contract rate'
        : then.price === 'reference_price'
        ? 'at its reference price'
        : then.price || '';
    return `place a PO with the ${sup} ${prc}`.trim();
  } else {
    const sug = then.suggest ? `suggest ${then.suggest} suppliers` : 'initiate sourcing';
    const flags = then.flags && then.flags.length > 0 ? ` (${then.flags.join(', ')})` : '';
    return `start a sourcing request (${then.route}, ${sug}${flags})`;
  }
}

export function renderRuleInPlainLanguage(rule: PolicyRule, policy: PolicyDocument): string {
  const conditions = predicateToText(rule.when, policy);
  const action = ruleOutcomeToText(rule);
  return `${rule.id} ${rule.then.route}: when ${conditions}, ${action}.`;
}

export function renderPolicyInPlainLanguage(policy: PolicyDocument): string[] {
  return policy.rules.filter((r) => r.enabled).map((r) => renderRuleInPlainLanguage(r, policy));
}
