import { prisma } from '../prisma.js';
import {
  DEFAULT_POLICY_V5,
  PolicyDocument,
  PolicyChangeSet,
  applyChangeSet,
  diffPolicies,
  lintPolicy,
  fallbackParseAmendment,
  renderPolicyInPlainLanguage,
} from '@cantill/policy';
import { callGroqChat } from '../groq.js';
import { runDecisionEngine } from '@cantill/engine';
import { loadEngineContext } from './data.service.js';

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
  "target_version": string (e.g. 5.1 for minor amendment, 6.0 for major replacement),
  "effective_from": string (YYYY-MM-DD),
  "is_amendment": boolean,
  "operations": Array of:
    - { "op": "set_param", "param": string, "value": any, "citation": string }
    - { "op": "add_rule", "position": number or "start" or "end", "rule": { "id": string, "name": string, "enabled": true, "when": object, "then": object }, "citation": string }
    - { "op": "update_rule", "rule_id": string, "changes": object, "citation": string }
    - { "op": "remove_rule", "rule_id": string, "citation": string }
    - { "op": "disable_rule", "rule_id": string, "citation": string }
  "citations": Array of { "operation_index": number, "sentence": string },
  "assumptions": Array of string (explicitly list any assumptions or ambiguities)
}

Return ONLY raw valid JSON.`;

  const llmResponse = await callGroqChat(
    [
      { role: 'system', content: 'You extract policy amendments into JSON.' },
      { role: 'user', content: prompt },
    ],
    true
  );

  if (llmResponse) {
    try {
      const parsed = JSON.parse(llmResponse);
      if (parsed.operations && Array.isArray(parsed.operations)) {
        return parsed as PolicyChangeSet;
      }
    } catch (e) {
      console.warn('Failed to parse Groq response, falling back to deterministic parser:', e);
    }
  }

  // 2. Deterministic Fallback Parser
  return fallbackParseAmendment(text, basePolicy);
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
