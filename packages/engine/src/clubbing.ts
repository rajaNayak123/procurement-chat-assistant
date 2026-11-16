import { ResolvedPRLine, Requirement, ItemMaster } from './types.js';
import { getCalendarDaysDiff, parseDateFlexible } from './utils/dates.js';
import { PolicyDocument } from '@cantill/policy';
import { selectPolicyVersionForDate } from './utils/policySelector.js';

export function clubPRLines(
  lines: ResolvedPRLine[],
  items: ItemMaster[],
  policiesOrClubDays: PolicyDocument[] | number = 14,
  clubNeedByDaysDefault: number = 7,
  forcedVersion?: string
): Requirement[] {
  const itemMap = new Map(items.map((i) => [i.item_code.toUpperCase(), i]));

  // Sort lines by (created_at, pr_no, pr_line)
  const sorted = [...lines].sort((a, b) => {
    const timeA = parseDateFlexible(a.created_at).getTime();
    const timeB = parseDateFlexible(b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.pr_no !== b.pr_no) return a.pr_no.localeCompare(b.pr_no);
    return a.pr_line - b.pr_line;
  });

  const requirements: Requirement[] = [];
  let reqCounter = 1;

  for (const line of sorted) {
    // Resolve clubbing window in force at line's calendar creation date
    let clubCreatedDays = 14;
    let clubNeedByDays = 7;
    if (Array.isArray(policiesOrClubDays)) {
      const linePolicy = selectPolicyVersionForDate(
        line.calendar_created_date,
        policiesOrClubDays,
        forcedVersion
      );
      clubCreatedDays = linePolicy.params.club_created_within_days ?? 14;
      clubNeedByDays = linePolicy.params.club_need_by_within_days ?? 7;
    } else {
      clubCreatedDays = policiesOrClubDays;
      clubNeedByDays = clubNeedByDaysDefault;
    }

    // Rule: NEW items are NEVER clubbed (even identical descriptions)
    if (line.is_new) {
      const reqId = `REQ-${String(reqCounter++).padStart(4, '0')}`;
      requirements.push({
        group_id: reqId,
        item_code: 'NEW',
        item_master: undefined,
        plant: line.plant,
        requirement_date: line.calendar_created_date,
        earliest_created_at: line.created_at,
        need_by_date: line.need_by_date,
        lines: [line],
        total_quantity: line.quantity,
        uom: line.uom,
        is_emergency: line.urgency === 'Emergency',
        valuation_price: line.estimated_unit_price || 0,
        valuation_source: line.estimated_unit_price ? 'requester_estimate' : 'missing',
        group_value_inr: (line.estimated_unit_price || 0) * line.quantity,
      });
      continue;
    }

    // Try to join an existing requirement
    let joined = false;
    for (const req of requirements) {
      if (req.item_code !== line.resolved_item_code) continue;
      if (req.plant !== line.plant) continue;

      const firstLine = req.lines[0];

      // Compare calendar dates: created within 14 calendar days of first line
      const createdDiff = Math.abs(
        getCalendarDaysDiff(line.calendar_created_date, firstLine.calendar_created_date)
      );
      if (createdDiff > clubCreatedDays) continue;

      // Need-by within 7 days either side of first line's need-by (inclusive)
      const needByDiff = Math.abs(
        getCalendarDaysDiff(line.need_by_date, firstLine.need_by_date)
      );
      if (needByDiff > clubNeedByDays) continue;

      // Line qualifies to join earliest matching requirement!
      req.lines.push(line);
      req.total_quantity += line.quantity;
      if (line.urgency === 'Emergency') {
        req.is_emergency = true;
      }
      joined = true;
      break;
    }

    if (!joined) {
      const reqId = `REQ-${String(reqCounter++).padStart(4, '0')}`;
      const itemMaster = itemMap.get(line.resolved_item_code.toUpperCase());
      requirements.push({
        group_id: reqId,
        item_code: line.resolved_item_code,
        item_master: itemMaster,
        plant: line.plant,
        requirement_date: line.calendar_created_date,
        earliest_created_at: line.created_at,
        need_by_date: line.need_by_date,
        lines: [line],
        total_quantity: line.quantity,
        uom: line.uom,
        is_emergency: line.urgency === 'Emergency',
        valuation_price: 0, // will be computed in valuation step
        valuation_source: 'missing',
        group_value_inr: 0,
      });
    }
  }

  return requirements;
}
