import { EvaluationContext, LeafPredicate, Predicate, PolicyDocument, ComparisonOperator } from './types.js';

export type FieldResolver = (ctx: EvaluationContext, args?: Record<string, any>) => any;

export const FIELD_REGISTRY: Record<string, FieldResolver> = {
  'item.code': (ctx) => ctx.item.code,
  'item.description': (ctx) => ctx.item.description,
  'item.category': (ctx) => ctx.item.category,
  'item.type': (ctx) => ctx.item.type,
  'item.uom': (ctx) => ctx.item.uom,
  'item.is_new': (ctx) => ctx.item.is_new,
  'item.standard_price': (ctx) => ctx.item.standard_price,

  'plant': (ctx) => ctx.plant,

  'req.value': (ctx) => ctx.req.value,
  'req.quantity': (ctx) => ctx.req.quantity,
  'req.line_count': (ctx) => ctx.req.line_count,
  'req.emergency': (ctx) => ctx.req.emergency,
  'req.urgency': (ctx) => ctx.req.urgency,
  'req.department': (ctx) => ctx.req.department,
  'req.need_by_days_ahead': (ctx) => ctx.req.need_by_days_ahead,

  'contract.exists': (ctx) => ctx.contract.exists,
  'contract.usable': (ctx) => ctx.contract.usable,
  'contract.ceiling_left': (ctx) => ctx.contract.ceiling_left,

  'history.bought_from_active': (ctx, args) => {
    const days = args?.days ?? 365;
    if (ctx.history.bought_from_active_fn) {
      return ctx.history.bought_from_active_fn(days);
    }
    return ctx.history.bought_from_active_365;
  },
  'history.po_count': (ctx, args) => {
    const days = args?.days ?? 365;
    if (ctx.history.po_count_fn) {
      return ctx.history.po_count_fn(days);
    }
    return ctx.history.po_count_365;
  },
  'history.last_po_age_days': (ctx) => ctx.history.last_po_age_days,

  'supplier.preferred_1.on_time_pct': (ctx) => ctx.supplier?.preferred_1?.on_time_pct ?? 0,
  'supplier.preferred_1.quality': (ctx) => ctx.supplier?.preferred_1?.quality ?? 0,
};

export function resolveValue(value: any, policy: PolicyDocument): any {
  if (value && typeof value === 'object' && 'param' in value) {
    const paramKey = value.param;
    return policy.params[paramKey];
  }
  return value;
}

export function evaluateOperator(actual: any, op: ComparisonOperator, expected: any): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'between':
      return (
        Array.isArray(expected) &&
        expected.length === 2 &&
        actual >= expected[0] &&
        actual <= expected[1]
      );
    case 'contains':
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;
    case 'exists':
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

export interface PredicateTrace {
  matched: boolean;
  leaf?: {
    field: string;
    actual: any;
    op: ComparisonOperator;
    expected: any;
    passed: boolean;
  };
  children?: PredicateTrace[];
}

export function evaluatePredicate(
  pred: Predicate,
  ctx: EvaluationContext,
  policy: PolicyDocument
): PredicateTrace {
  // Check if leaf
  if ('field' in pred && 'op' in pred) {
    const leaf = pred as LeafPredicate;
    const resolver = FIELD_REGISTRY[leaf.field];
    if (!resolver) {
      return {
        matched: false,
        leaf: {
          field: leaf.field,
          actual: undefined,
          op: leaf.op,
          expected: leaf.value,
          passed: false,
        },
      };
    }

    const actual = resolver(ctx, leaf.args);
    const expected = resolveValue(leaf.value, policy);
    const passed = evaluateOperator(actual, leaf.op, expected);

    return {
      matched: passed,
      leaf: {
        field: leaf.field,
        actual,
        op: leaf.op,
        expected,
        passed,
      },
    };
  }

  // Nested all
  if ('all' in pred && Array.isArray(pred.all)) {
    const childTraces = pred.all.map((child) => evaluatePredicate(child, ctx, policy));
    const matched = childTraces.every((t) => t.matched);
    return {
      matched,
      children: childTraces,
    };
  }

  // Nested any
  if ('any' in pred && Array.isArray(pred.any)) {
    const childTraces = pred.any.map((child) => evaluatePredicate(child, ctx, policy));
    const matched = childTraces.some((t) => t.matched);
    return {
      matched,
      children: childTraces,
    };
  }

  // Nested not
  if ('not' in pred && pred.not) {
    const childTrace = evaluatePredicate(pred.not, ctx, policy);
    return {
      matched: !childTrace.matched,
      children: [childTrace],
    };
  }

  return { matched: false };
}

export interface FailingCondition {
  field: string;
  actual: any;
  op: ComparisonOperator;
  expected: any;
}

export function extractFailingConditions(trace: PredicateTrace): FailingCondition[] {
  const failures: FailingCondition[] = [];
  function walk(t: PredicateTrace) {
    if (t.leaf && !t.leaf.passed) {
      failures.push({
        field: t.leaf.field,
        actual: t.leaf.actual,
        op: t.leaf.op,
        expected: t.leaf.expected,
      });
    }
    if (t.children) {
      for (const child of t.children) {
        walk(child);
      }
    }
  }
  walk(trace);
  return failures;
}
