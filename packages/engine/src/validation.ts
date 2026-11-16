import { PlantMaster, PRLineInput, ResolvedPRLine, NotProcessedRow } from './types.js';
import { ItemMatcher } from './matching.js';
import { parseDateFlexible, toCalendarDateString, getCalendarDaysDiff } from './utils/dates.js';

export interface ValidationBatchResult {
  validLines: ResolvedPRLine[];
  notProcessed: NotProcessedRow[];
}

export function validateAndResolvePRBatch(
  rawLines: PRLineInput[],
  plants: PlantMaster[],
  itemMatcher: ItemMatcher
): ValidationBatchResult {
  const validPlants = new Set(plants.map((p) => p.plant.toUpperCase()));
  const validLines: ResolvedPRLine[] = [];
  const notProcessed: NotProcessedRow[] = [];
  const seenPrKeys = new Set<string>();

  for (const raw of rawLines) {
    const prNo = String(raw.pr_no || '').trim();
    const prLine = String(raw.pr_line || '').trim();
    const prKey = `${prNo}:${prLine}`;

    // 1. Missing PR No or PR Line
    if (!prNo || !prLine) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: 'Missing pr_no or pr_line',
        raw_line: raw,
      });
      continue;
    }

    // 2. Duplicate within batch
    if (seenPrKeys.has(prKey)) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: `Duplicate pr_no and pr_line (${prKey}) in batch`,
        raw_line: raw,
      });
      continue;
    }
    seenPrKeys.add(prKey);

    // 3. Plant validation
    const rawPlant = String(raw.plant || '').trim().toUpperCase();
    if (!validPlants.has(rawPlant)) {
      const allowedList = Array.from(validPlants).join(', ');
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: `Invalid plant "${raw.plant}". Allowed plants are: ${allowedList}`,
        raw_line: raw,
      });
      continue;
    }

    // 4. Quantity validation
    const parsedQty = typeof raw.quantity === 'number' ? raw.quantity : parseFloat(String(raw.quantity).replace(/,/g, ''));
    if (isNaN(parsedQty) || parsedQty <= 0) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: `Invalid quantity "${raw.quantity}". Must be a positive number greater than 0`,
        raw_line: raw,
      });
      continue;
    }

    // 5. Date validation
    const parsedCreatedAt = parseDateFlexible(raw.created_at);
    if (isNaN(parsedCreatedAt.getTime())) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: `Invalid or missing created_at date "${raw.created_at}"`,
        raw_line: raw,
      });
      continue;
    }

    const parsedNeedBy = parseDateFlexible(raw.need_by_date);
    if (isNaN(parsedNeedBy.getTime())) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: `Invalid or missing need_by_date "${raw.need_by_date}"`,
        raw_line: raw,
      });
      continue;
    }

    // 6. Check empty description and code
    const rawCode = raw.item_code ? String(raw.item_code).trim() : '';
    const rawDesc = raw.description ? String(raw.description).trim() : '';
    if (!rawCode && !rawDesc) {
      notProcessed.push({
        pr_no: prNo,
        pr_line: prLine,
        reason: 'Both item_code and description are missing or empty',
        raw_line: raw,
      });
      continue;
    }

    // Parse flags
    const flags: string[] = [];

    // Check need-by earlier than creation
    if (getCalendarDaysDiff(parsedNeedBy, parsedCreatedAt) < 0) {
      flags.push('need_by_date precedes created_at');
    }

    // Urgency check
    const rawUrgency = String(raw.urgency || 'Normal').trim().toLowerCase();
    const cleanUrgency: 'Normal' | 'Emergency' = rawUrgency === 'emergency' ? 'Emergency' : 'Normal';

    // Check if description mentions urgent while urgency is Normal
    if (cleanUrgency === 'Normal') {
      if (/\b(urgent|asap|breakdown|immediate)\b/i.test(rawDesc)) {
        flags.push('description mentions urgent/asap but urgency is Normal');
      }
    }

    // Parse estimated price
    let estimatedPrice: number | null = null;
    if (raw.estimated_unit_price !== undefined && raw.estimated_unit_price !== null && String(raw.estimated_unit_price).trim() !== '') {
      const p = typeof raw.estimated_unit_price === 'number'
        ? raw.estimated_unit_price
        : parseFloat(String(raw.estimated_unit_price).replace(/,/g, ''));
      if (!isNaN(p) && p >= 0) {
        estimatedPrice = p;
      }
    }

    // Match item
    const match = itemMatcher.match(rawCode, rawDesc);
    flags.push(...match.flags);

    if (match.is_new && estimatedPrice === null) {
      flags.push('estimate missing for new item');
    }

    validLines.push({
      pr_no: prNo,
      pr_line: parseInt(prLine, 10) || 1,
      created_at: parsedCreatedAt.toISOString(),
      calendar_created_date: toCalendarDateString(parsedCreatedAt),
      requester: String(raw.requester || '').trim(),
      department: String(raw.department || '').trim(),
      plant: rawPlant,
      input_item_code: rawCode || undefined,
      resolved_item_code: match.resolved_item_code,
      is_new: match.is_new,
      description: rawDesc,
      quantity: parsedQty,
      uom: String(raw.uom || match.matched_item?.uom || 'NOS').trim(),
      estimated_unit_price: estimatedPrice,
      need_by_date: toCalendarDateString(parsedNeedBy),
      urgency: cleanUrgency,
      match_method: match.match_method,
      match_confidence: match.match_confidence,
      flags,
      raw_line: raw,
    });
  }

  return { validLines, notProcessed };
}
