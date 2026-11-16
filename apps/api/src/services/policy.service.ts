import crypto from 'crypto';
import { prisma } from '../prisma.js';
import {
  DEFAULT_POLICY_V5,
  PolicyDocument,
  PolicyChangeSet,
  PolicyChangeSetSchema,
  applyChangeSet,
  diffPolicies,
  lintPolicy,
  fallbackParseAmendment,
  renderPolicyInPlainLanguage,
} from '@cantill/policy';
import { callGroqChat } from '../groq.js';
import { runDecisionEngine } from '@cantill/engine';
import { loadEngineContext } from './data.service.js';

// Cache parsed change sets by SHA-256 of (baseVersion + text) to avoid Groq rate limits
const amendmentCache = new Map<string, PolicyChangeSet>();

function getCacheKey(text: string, baseVersion: string): string {
  return crypto.createHash('sha256').update(`${baseVersion}:${text.trim()}`).digest('hex');
}

export async function getActivePolicy(asOfDate?: string): Promise<PolicyDocument> {
  const versions = await prisma.policyVersion.findMany({
    where: { status: { in: ['active', 'approved'] } },
    orderBy: { effective_from: 'desc' },
  });

  if (versions.length === 0) {
    return DEFAULT_POLICY_V5;
  }

  if (asOfDate) {
    const matched = versions.find((v) => v.effective_from <= asOfDate);
    if (matched) {
      try {
        return JSON.parse(matched.policy_json);
      } catch {
        return DEFAULT_POLICY_V5;
      }
    }
  }

  try {
    return JSON.parse(versions[0].policy_json);
  } catch {
    return DEFAULT_POLICY_V5;
  }
}

export async function parsePolicyAmendment(
  text: string,
  basePolicy: PolicyDocument
): Promise<PolicyChangeSet> {
  const cacheKey = getCacheKey(text, basePolicy.version);
  if (amendmentCache.has(cacheKey)) {
    return amendmentCache.get(cacheKey)!;
  }

  // 1. Try Groq LLM if configured
  const prompt = `You are a procurement policy analyst for Corvo Engineering.
Given the current procurement policy v${basePolicy.version}:
${JSON.stringify(basePolicy, null, 2)}

Analyze this amendment text:
"""${text}"""

Extract a structured policy change set conforming to this JSON schema:
{
  "policy_id": "${basePolicy.policy_id}",
  "base_version": "${basePolicy.version}",
  "target_version": string (e.g. "5.1" for minor amendment, "6.0" for major replacement),
  "effective_from": string (YYYY-MM-DD),
  "is_amendment": true,
  "operations": Array of:
    - { "op": "set_param", "param": string, "value": any, "citation": string }
    - { "op": "add_rule", "position": number or "start" or "end", "rule": { "id": string, "name": string, "enabled": true, "when": object, "then": object }, "citation": string }
    - { "op": "update_rule", "rule_id": string, "changes": object, "citation": string }
    - { "op": "remove_rule", "rule_id": string, "citation": string }
    - { "op": "disable_rule", "rule_id": string, "citation": string }
  "citations": Array of { "operation_index": number, "sentence": string },
  "assumptions": Array of string
}

AVAILABLE FIELD REGISTRY for "when" predicates:
- "item.code" (string)
- "item.description" (string)
- "item.category" (string)
- "item.type" ("Material" | "Service" | "Capex")
- "item.uom" (string)
- "item.is_new" (boolean)
- "item.standard_price" (number)
- "plant" (string, e.g. "CHN1", "CHK1", "PUN1")
- "req.value" (number, in INR)
- "req.quantity" (number)
- "req.line_count" (number)
- "req.emergency" (boolean)
- "req.urgency" ("Normal" | "Emergency")
- "req.department" (string)
- "req.need_by_days_ahead" (number)
- "contract.exists" (boolean)
- "contract.usable" (boolean)
- "contract.ceiling_left" (number)
- "history.bought_from_active" (boolean; optional args: { "days": number }, default 365)
- "history.po_count" (number; optional args: { "days": number }, default 365)
- "history.last_po_age_days" (number | null)
- "history.last_po_price" (number | null)
- "supplier.preferred_1.on_time_pct" (number)
- "supplier.preferred_1.quality" (number)

AVAILABLE COMPARISON OPERATORS:
- "eq", "ne", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains", "exists"

AVAILABLE RULE OUTCOMES:
- "decision": "PO" | "SOURCING_REQUEST"
- "route": "CONTRACT_PO" | "EMERGENCY_PO" | "SPOT_PO" | "RFQ" | "RFP" | "CAPEX_SOURCING" | "NEW_ITEM_SOURCING"
- "supplier": "contract" | "preferred_1" | "preferred_n" | "none"
- "price": "contract_rate" | "reference_price" | "last_po" | "standard"
- "suggest": number (e.g. 3)

CONFIGURABLE POLICY PARAMETERS (for "set_param"):
- spot_limit (number)
- emergency_limit (number)
- rfp_threshold (number)
- club_created_within_days (number)
- club_need_by_within_days (number)
- consolidation_window_hours (number)
- recent_purchase_days (number)
- price_lookback_days (number)
- preferred_lookback_days (number)
- excluded_supplier_statuses (string[])
- ranking.weights.frequency (number)
- ranking.weights.recency (number)
- ranking.weights.contract (number)
- ranking.weights.on_time (number)
- ranking.weights.quality (number)
- ranking.min_on_time_pct (number)
- ranking.min_quality (number)

Return ONLY valid raw JSON matching the schema.`;

  let llmResponse = await callGroqChat(
    [
      { role: 'system', content: 'You extract policy amendments into raw JSON adhering to the specified schema.' },
      { role: 'user', content: prompt },
    ],
    true
  );

  let validatedChangeSet: PolicyChangeSet | null = null;

  if (llmResponse) {
    try {
      const parsed = JSON.parse(llmResponse);
      const zodCheck = PolicyChangeSetSchema.safeParse(parsed);
      if (zodCheck.success) {
        validatedChangeSet = zodCheck.data as PolicyChangeSet;
      } else {
        // Retry once with validation issues
        console.warn('First LLM attempt failed Zod validation, retrying once:', zodCheck.error.issues);
        const retryPrompt = `Your previous output failed Zod schema validation with these issues:
${JSON.stringify(zodCheck.error.issues, null, 2)}

Please fix all schema issues and output strictly valid JSON conforming to PolicyChangeSet.`;
        const retryResponse = await callGroqChat(
          [
            { role: 'system', content: 'You extract policy amendments into raw JSON adhering to the specified schema.' },
            { role: 'user', content: prompt },
            { role: 'assistant', content: llmResponse },
            { role: 'user', content: retryPrompt },
          ],
          true
        );

        if (retryResponse) {
          const retryParsed = JSON.parse(retryResponse);
          const retryZodCheck = PolicyChangeSetSchema.safeParse(retryParsed);
          if (retryZodCheck.success) {
            validatedChangeSet = retryZodCheck.data as PolicyChangeSet;
          }
        }
      }
    } catch (e) {
      console.warn('Groq parsing/validation error, falling back to deterministic parser:', e);
    }
  }

  if (validatedChangeSet) {
    amendmentCache.set(cacheKey, validatedChangeSet);
    return validatedChangeSet;
  }

  // 2. Deterministic Fallback Parser (fails loudly if zero operations are found)
  const fallbackResult = fallbackParseAmendment(text, basePolicy);
  amendmentCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

export async function computeImpactPreview(
  oldPolicy: PolicyDocument,
  candidatePolicy: PolicyDocument
) {
  // Load current workspace PR lines
  const prLinesDb = await prisma.pRLine.findMany();
  if (prLinesDb.length === 0) {
    return {
      affectedRequirementsCount: 0,
      totalRequirementsCount: 0,
      changes: [],
    };
  }

  const rawLines = prLinesDb.map((l) => ({
    pr_no: l.pr_no,
    pr_line: l.pr_line,
    created_at: l.created_at.toISOString(),
    requester: l.requester,
    department: l.department,
    plant: l.plant,
    item_code: l.resolved_item_code,
    description: l.description,
    quantity: l.quantity,
    uom: l.uom,
    estimated_unit_price: l.estimated_unit_price,
    need_by_date: l.need_by_date,
    urgency: l.urgency,
  }));

  const contextOld = await loadEngineContext();
  contextOld.policy_versions = [oldPolicy];
  const oldResult = runDecisionEngine(rawLines, contextOld);

  const contextNew = await loadEngineContext();
  contextNew.policy_versions = [candidatePolicy];
  const newResult = runDecisionEngine(rawLines, contextNew);

  const changes: Array<{
    group_id: string;
    item_code: string;
    plant: string;
    old_route: string;
    new_route: string;
    old_supplier?: string;
    new_supplier?: string;
    old_value: number;
    new_value: number;
  }> = [];

  const oldMap = new Map(oldResult.requirements.map((r) => [r.group_id, r]));
  for (const newReq of newResult.requirements) {
    const oldReq = oldMap.get(newReq.group_id);
    if (oldReq) {
      const routeChanged = oldReq.decision?.route !== newReq.decision?.route;
      const supplierChanged = oldReq.decision?.supplier_id !== newReq.decision?.supplier_id;
      const valueChanged = Math.abs(oldReq.group_value_inr - newReq.group_value_inr) > 1;

      if (routeChanged || supplierChanged || valueChanged) {
        changes.push({
          group_id: newReq.group_id,
          item_code: newReq.item_code,
          plant: newReq.plant,
          old_route: oldReq.decision?.route || 'NONE',
          new_route: newReq.decision?.route || 'NONE',
          old_supplier: oldReq.decision?.supplier_id,
          new_supplier: newReq.decision?.supplier_id,
          old_value: oldReq.group_value_inr,
          new_value: newReq.group_value_inr,
        });
      }
    }
  }

  return {
    affectedRequirementsCount: changes.length,
    totalRequirementsCount: newResult.requirements.length,
    changes,
  };
}
