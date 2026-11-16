import { z } from 'zod';

export const ComparisonOperatorSchema = z.enum([
  'eq',
  'ne',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'exists',
]);

export const ValueOrParamSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
  z.object({ param: z.string() }),
]);

export const LeafPredicateSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    field: z.string(),
    args: z.record(z.any()).optional(),
    op: ComparisonOperatorSchema,
    value: ValueOrParamSchema.optional(),
  })
);

export const PredicateSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    LeafPredicateSchema,
    z.object({
      all: z.array(PredicateSchema).optional(),
      any: z.array(PredicateSchema).optional(),
      not: PredicateSchema.optional(),
    }),
  ])
);

export const RuleOutcomeSchema = z.object({
  decision: z.enum(['PO', 'SOURCING_REQUEST']),
  route: z.string(),
  supplier: z.enum(['contract', 'preferred_1', 'preferred_n', 'none']).or(z.string()).optional(),
  price: z.enum(['contract_rate', 'reference_price', 'last_po', 'standard']).or(z.string()).optional(),
  suggest: z.number().int().nonnegative().optional(),
  flags: z.array(z.string()).optional(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  when: PredicateSchema,
  then: RuleOutcomeSchema,
});

export const RankingWeightsSchema = z.object({
  frequency: z.number().min(0),
  recency: z.number().min(0),
  contract: z.number().min(0),
  on_time: z.number().min(0),
  quality: z.number().min(0),
});

export const RecencyTierSchema = z.object({
  max_days: z.number().positive(),
  score: z.number().min(0).max(1),
});

export const RankingParamsSchema = z.object({
  weights: RankingWeightsSchema,
  recency_tiers: z.array(RecencyTierSchema),
  tie_breakers: z.array(z.string()),
  min_on_time_pct: z.number().nullable().optional(),
  min_quality: z.number().nullable().optional(),
});

export const TopupParamsSchema = z.object({
  weights: z.object({
    on_time: z.number().min(0),
    quality: z.number().min(0),
  }),
  match: z.string(),
});

export const PolicyParamsSchema = z.object({
  club_created_within_days: z.number().positive(),
  club_need_by_within_days: z.number().positive(),
  recent_purchase_days: z.number().positive(),
  price_lookback_days: z.number().positive(),
  preferred_lookback_days: z.number().positive(),
  consolidation_window_hours: z.number().positive(),
  excluded_supplier_statuses: z.array(z.string()),
  spot_limit: z.number().nonnegative(),
  emergency_limit: z.number().nonnegative(),
  rfp_threshold: z.number().nonnegative(),
  ranking: RankingParamsSchema,
  topup: TopupParamsSchema,
}).catchall(z.any());

export const PolicyDocumentSchema = z.object({
  policy_id: z.string(),
  version: z.string(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  status: z.enum(['draft', 'pending_approval', 'approved', 'active', 'superseded']),
  params: PolicyParamsSchema,
  rules: z.array(PolicyRuleSchema),
});

export type ValidatedPolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const PolicyOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set_param'),
    param: z.string(),
    value: z.any(),
    citation: z.string().optional(),
  }),
  z.object({
    op: z.literal('add_rule'),
    position: z.union([z.number(), z.literal('start'), z.literal('end')]).optional(),
    rule: PolicyRuleSchema,
    citation: z.string().optional(),
  }),
  z.object({
    op: z.literal('update_rule'),
    rule_id: z.string(),
    changes: z.record(z.any()),
    citation: z.string().optional(),
  }),
  z.object({
    op: z.literal('remove_rule'),
    rule_id: z.string(),
    citation: z.string().optional(),
  }),
  z.object({
    op: z.literal('disable_rule'),
    rule_id: z.string(),
    citation: z.string().optional(),
  }),
  z.object({
    op: z.literal('reorder'),
    order: z.array(z.string()),
    citation: z.string().optional(),
  }),
]);

export const PolicyChangeSetSchema = z.object({
  change_set_id: z.string().optional(),
  policy_id: z.string(),
  base_version: z.string(),
  target_version: z.string(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  is_amendment: z.boolean(),
  operations: z.array(PolicyOperationSchema).min(1, 'At least one operation is required'),
  citations: z
    .array(
      z.object({
        operation_index: z.number(),
        sentence: z.string(),
      })
    )
    .optional()
    .default([]),
  assumptions: z.array(z.string()).optional().default([]),
});

export type ValidatedPolicyChangeSet = z.infer<typeof PolicyChangeSetSchema>;
