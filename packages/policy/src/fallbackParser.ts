import { PolicyDocument, PolicyRule } from './types.js';
import { PolicyChangeSet, PolicyOperation } from './changeSet.js';

export function parseLakh(str: string): number | null {
  const lakhMatch = str.match(/([\d.]+)\s*(?:lakh|lakhs|lac|lacs)/i);
  if (lakhMatch) {
    return Math.round(parseFloat(lakhMatch[1]) * 100000);
  }
  const clean = str.replace(/[^\d.]/g, '');
  if (clean) {
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  }
  return null;
}

export function parseEffectiveDate(text: string): string {
  // Try YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // Try "from 25 Nov 2026" or "25 Nov"
  const dateMatch = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(20\d{2})?/i);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = monthNames[dateMatch[2].toLowerCase().substring(0, 3)] || '11';
    const year = dateMatch[3] || '2026';
    return `${year}-${month}-${day}`;
  }

  // Default fallback date
  return '2026-11-20';
}

export function fallbackParseAmendment(
  text: string,
  basePolicy: PolicyDocument
): PolicyChangeSet {
  const operations: PolicyOperation[] = [];
  const citations: Array<{ operation_index: number; sentence: string }> = [];
  const assumptions: string[] = [];

  const effectiveFrom = parseEffectiveDate(text);
  const sentences = text.split(/(?<=[.?!;])\s+|\n+/).filter((s) => s.trim().length > 0);

  // Check next minor version
  const [major, minor] = basePolicy.version.split('.').map(Number);
  const targetVersion = `${major}.${(minor || 0) + 1}`;

  for (const sentence of sentences) {
    const s = sentence.trim();

    // 1. Plant + Category spot rule: "at CHK1, Lubricants below 3 lakh may be bought spot"
    const plantCatSpot = s.match(/at\s+([A-Z0-9]+)[,\s]+([A-Za-z\s]+)\s+below\s+([\d.,\s]+(?:lakh|lakhs)?)\s+may\s+be\s+bought\s+spot/i);
    if (plantCatSpot) {
      const plant = plantCatSpot[1].toUpperCase();
      const category = plantCatSpot[2].trim();
      const limit = parseLakh(plantCatSpot[3]) ?? 300000;
      const ruleId = `5.3b-${plant.toLowerCase()}`;
      const newRule: PolicyRule = {
        id: ruleId,
        name: `Spot_${category}_${plant}`,
        enabled: true,
        when: {
          all: [
            { field: 'plant', op: 'eq', value: plant },
            { field: 'item.category', op: 'eq', value: category },
            { field: 'req.value', op: 'lte', value: limit },
            { field: 'history.bought_from_active', args: { days: 365 }, op: 'eq', value: true },
          ],
        },
        then: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier: 'preferred_1',
          price: 'reference_price',
        },
      };

      operations.push({
        op: 'add_rule',
        position: 3, // insert before standard spot rule
        rule: newRule,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Created specialized rule ${ruleId} for plant ${plant} and category ${category} with limit ${limit}`);
      continue;
    }

    // 2. Category specific spot limit: "raise the spot limit for Packaging to 3 lakh"
    const catSpotMatch = s.match(/(?:raise|set|change)\s+(?:the\s+)?spot\s+limit\s+for\s+([A-Za-z\s]+)\s+to\s+([\d.,\s]+(?:lakh|lakhs)?)/i);
    if (catSpotMatch) {
      const category = catSpotMatch[1].trim();
      const limit = parseLakh(catSpotMatch[2]) ?? 300000;
      const ruleId = `5.4-${category.toLowerCase().replace(/\s+/g, '_')}`;
      const newRule: PolicyRule = {
        id: ruleId,
        name: `Spot_${category}`,
        enabled: true,
        when: {
          all: [
            { field: 'item.category', op: 'eq', value: category },
            { field: 'req.value', op: 'lt', value: limit },
            { field: 'history.bought_from_active', args: { days: 365 }, op: 'eq', value: true },
          ],
        },
        then: {
          decision: 'PO',
          route: 'SPOT_PO',
          supplier: 'preferred_1',
          price: 'reference_price',
        },
      };

      operations.push({
        op: 'add_rule',
        position: 3,
        rule: newRule,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Created category-specific spot rule ${ruleId} for ${category} with threshold ${limit}`);
      continue;
    }

    // 3. General spot limit change: "raise spot limit to 3 lakh" or "change spot limit to 300000"
    const spotMatch = s.match(/(?:raise|set|change)\s+(?:the\s+)?spot\s+limit\s+to\s+([\d.,\s]+(?:lakh|lakhs)?)/i);
    if (spotMatch) {
      const limit = parseLakh(spotMatch[1]);
      if (limit !== null) {
        operations.push({
          op: 'set_param',
          param: 'spot_limit',
          value: limit,
          citation: s,
        });
        citations.push({ operation_index: operations.length - 1, sentence: s });
        assumptions.push(`Updated global spot_limit to ${limit}`);
        continue;
      }
    }

    // 4. Emergency limit change: "raise emergency limit to 7.5 lakh"
    const emergMatch = s.match(/(?:raise|set|change)\s+(?:the\s+)?emergency\s+limit\s+to\s+([\d.,\s]+(?:lakh|lakhs)?)/i);
    if (emergMatch) {
      const limit = parseLakh(emergMatch[1]);
      if (limit !== null) {
        operations.push({
          op: 'set_param',
          param: 'emergency_limit',
          value: limit,
          citation: s,
        });
        citations.push({ operation_index: operations.length - 1, sentence: s });
        assumptions.push(`Updated global emergency_limit to ${limit}`);
        continue;
      }
    }

    // 5. Clubbing window: "change clubbing window to 10 days"
    const clubMatch = s.match(/(?:change|set)\s+clubbing\s+(?:window\s+)?to\s+(\d+)\s+days/i);
    if (clubMatch) {
      const days = parseInt(clubMatch[1], 10);
      operations.push({
        op: 'set_param',
        param: 'club_created_within_days',
        value: days,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Changed clubbing window to ${days} days`);
      continue;
    }

    // 6. Consolidation window: "change consolidation window to 48 hours"
    const consolMatch = s.match(/(?:change|set)\s+consolidation\s+(?:window\s+)?to\s+(\d+)\s+hours/i);
    if (consolMatch) {
      const hours = parseInt(consolMatch[1], 10);
      operations.push({
        op: 'set_param',
        param: 'consolidation_window_hours',
        value: hours,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Changed consolidation window to ${hours} hours`);
      continue;
    }

    // 7. Force RFQ for category: "require RFQ for Electrical Spares" / "force RFQ for Electrical Spares"
    const forceRfqMatch = s.match(/(?:require|force)\s+RFQ\s+for\s+([A-Za-z\s]+)/i);
    if (forceRfqMatch) {
      const category = forceRfqMatch[1].trim();
      const ruleId = `5.4-rfq-${category.toLowerCase().replace(/\s+/g, '_')}`;
      const newRule: PolicyRule = {
        id: ruleId,
        name: `Force_RFQ_${category}`,
        enabled: true,
        when: {
          all: [{ field: 'item.category', op: 'eq', value: category }],
        },
        then: {
          decision: 'SOURCING_REQUEST',
          route: 'RFQ',
          suggest: 3,
        },
      };

      operations.push({
        op: 'add_rule',
        position: 3,
        rule: newRule,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Added mandatory RFQ rule for category ${category}`);
      continue;
    }

    // 8. Ranking weights change: "change frequency weight to 0.35" or "set ranking weight for recency to 0.20"
    const weightMatch = s.match(/(?:change|set)\s+(?:ranking\s+)?(?:weight\s+for\s+)?(frequency|recency|contract|on_time|quality)\s+(?:weight\s+)?to\s+([0-9.]+)/i);
    if (weightMatch) {
      const field = weightMatch[1].toLowerCase();
      const weightVal = parseFloat(weightMatch[2]);
      if (!isNaN(weightVal)) {
        operations.push({
          op: 'set_param',
          param: `ranking.weights.${field}`,
          value: weightVal,
          citation: s,
        });
        citations.push({ operation_index: operations.length - 1, sentence: s });
        assumptions.push(`Updated ranking weight for ${field} to ${weightVal}`);
        continue;
      }
    }

    // 9. Supplier eligibility threshold: "set minimum on-time to 90%" or "require minimum on-time of 90%"
    const minOnTimeMatch = s.match(/(?:set|require)\s+minimum\s+on-?time\s+(?:percentage\s+)?(?:to|of)?\s*(\d+)\s*%/i);
    if (minOnTimeMatch) {
      const minPct = parseInt(minOnTimeMatch[1], 10);
      operations.push({
        op: 'set_param',
        param: 'ranking.min_on_time_pct',
        value: minPct,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Set minimum supplier on-time eligibility threshold to ${minPct}%`);
      continue;
    }

    // 10. Disable/Remove rule: "disable rule 5.1" or "remove rule 5.1"
    const removeMatch = s.match(/(?:disable|remove)\s+rule\s+([\d]+(?:\.[\d]+)*)/i);
    if (removeMatch) {
      const ruleId = removeMatch[1];
      const isDisable = s.toLowerCase().includes('disable');
      operations.push(
        isDisable
          ? { op: 'disable_rule', rule_id: ruleId, citation: s }
          : { op: 'remove_rule', rule_id: ruleId, citation: s }
      );
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`${isDisable ? 'Disabled' : 'Removed'} rule ${ruleId}`);
      continue;
    }
  }

  return {
    policy_id: basePolicy.policy_id,
    base_version: basePolicy.version,
    target_version: targetVersion,
    effective_from: effectiveFrom,
    is_amendment: true,
    operations,
    citations,
    assumptions,
  };
}
