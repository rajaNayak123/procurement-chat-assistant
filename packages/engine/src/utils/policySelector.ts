import { PolicyDocument, DEFAULT_POLICY_V5 } from '@cantill/policy';
import { getCalendarDaysDiff } from './dates.js';

export function selectPolicyVersionForDate(
  requirementDate: string,
  policies: PolicyDocument[],
  forcedVersion?: string
): PolicyDocument {
  if (forcedVersion) {
    const forced = policies.find((p) => p.version === forcedVersion);
    if (forced) return forced;
  }

  // Sort policies by effective_from descending
  const sorted = [...policies].sort((a, b) =>
    getCalendarDaysDiff(b.effective_from, a.effective_from)
  );

  // Filter policies where effective_from <= requirementDate
  const eligible = sorted.filter((p) => {
    const diff = getCalendarDaysDiff(requirementDate, p.effective_from);
    return diff >= 0;
  });

  if (eligible.length === 0) {
    // If requirementDate is earlier than all versions, return the earliest policy
    return sorted[sorted.length - 1] || DEFAULT_POLICY_V5;
  }

  // Latest effective version in force as of requirementDate
  return eligible[0];
}
