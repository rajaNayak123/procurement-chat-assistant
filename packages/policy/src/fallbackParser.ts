import { PolicyDocument, PolicyRule } from './types.js';
import { PolicyChangeSet, PolicyOperation } from './changeSet.js';

export function parseLakh(str: string): number | null {
  if (!str) return null;
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

export function parseEffectiveDate(text: string): string | null {
  // 1. Try ISO YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };

  // 2. Try Day Month Year (e.g. "25 November 2026", "with effect from 25 November 2026", "25th Nov 2026")
  const dmMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[a-z]*(?:,?\s+(20\d{2}))?\b/i);
  if (dmMatch) {
    const day = dmMatch[1].padStart(2, '0');
    const month = monthNames[dmMatch[2].toLowerCase()] || '11';
    const year = dmMatch[3] || '2026';
    return `${year}-${month}-${day}`;
  }

  // 3. Try Month Day, Year (e.g. "November 25, 2026")
  const mdMatch = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i);
  if (mdMatch) {
    const month = monthNames[mdMatch[1].toLowerCase()] || '11';
    const day = mdMatch[2].padStart(2, '0');
    const year = mdMatch[3] || '2026';
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function fallbackParseAmendment(
  text: string,
  basePolicy: PolicyDocument
): PolicyChangeSet {
  const operations: PolicyOperation[] = [];
  const citations: Array<{ operation_index: number; sentence: string }> = [];
  const assumptions: string[] = [];

  const parsedDate = parseEffectiveDate(text);
  const sentences = text.split(/(?<=[.?!;])\s+|\n+/).filter((s) => s.trim().length > 0);

  const [major, minor] = basePolicy.version.split('.').map(Number);
  const targetVersion = `${major}.${(minor || 0) + 1}`;

  for (const sentence of sentences) {
    const s = sentence.trim();

    // 1. Rule withdrawal / repeal / disable / remove:
    // "Rule 5.3 is withdrawn", "Rule 5.3 shall be withdrawn", "Rule 5.3 is repealed", "disable rule 5.1", "withdraw Rule 5.3"
    const ruleWithdrawMatch =
      s.match(/rule\s+([\d]+(?:\.[\d]+[a-z]?)*)\s+(?:is|shall\s+be|has\s+been)\s+(?:withdrawn|repealed|deleted|disabled|removed)/i) ||
      s.match(/(?:disable|remove|withdraw|repeal|delete)\s+rule\s+([\d]+(?:\.[\d]+[a-z]?)*)/i);
    if (ruleWithdrawMatch) {
      const ruleId = ruleWithdrawMatch[1];
      operations.push({
        op: 'disable_rule',
        rule_id: ruleId,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Disabled rule ${ruleId} per amendment text`);
      continue;
    }

    // 2. Plant + Category spot rule:
    // "at CHK1, Lubricants below 3 lakh may be bought spot"
    const plantCatSpot = s.match(/at\s+([A-Z0-9]+)[,\s]+([A-Za-z\s]+)\s+(?:below|up\s+to)\s+([\d.,\s]+(?:lakh|lakhs)?)\s+(?:may|shall)\s+be\s+bought\s+spot/i);
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
        position: 3,
        rule: newRule,
        citation: s,
      });
      citations.push({ operation_index: operations.length - 1, sentence: s });
      assumptions.push(`Created specialized rule ${ruleId} for plant ${plant} and category ${category} with limit ${limit}`);
      continue;
    }

    // 3. Category specific spot limit:
    // "The spot limit for Packaging is raised from Rs 2,00,000 to Rs 3,00,000", "The spot limit for Packaging shall be 3 lakh", "raise spot limit for Packaging to 3 lakh"
    const catSpotFromTo = s.match(/(?:the\s+)?spot\s+limit\s+for\s+([A-Za-z\s]+?)\s+(?:is|shall\s+be|has\s+been)?\s*(?:raised|increased|reduced|revised|changed)\s+from\s+(?:Rs\.?|INR|₹)?\s*[\d.,\s]+?(?:lakh|lakhs)?\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);
    const catSpotDirect = s.match(/(?:the\s+)?spot\s+limit\s+for\s+([A-Za-z\s]+?)\s+(?:shall\s+be|is\s+set\s+to|is\s+raised\s+to|is\s+changed\s+to|is)\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i) ||
      s.match(/(?:raise|set|change|increase|reduce)\s+(?:the\s+)?spot\s+limit\s+for\s+([A-Za-z\s]+?)\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);

    if (catSpotFromTo || catSpotDirect) {
      const category = (catSpotFromTo ? catSpotFromTo[1] : catSpotDirect![1]).trim();
      const valStr = catSpotFromTo ? catSpotFromTo[2] : catSpotDirect![2];
      const limit = parseLakh(valStr) ?? 300000;
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

    // 4. General spot limit change:
    // "The spot limit is raised from Rs 2,00,000 to Rs 3,00,000 with effect from 25 November 2026"
    // "The spot limit shall be Rs 3,00,000"
    // "raise spot limit to 3 lakh"
    const spotFromTo = s.match(/(?:the\s+)?spot\s+limit\s+(?:is|shall\s+be|has\s+been)?\s*(?:raised|increased|reduced|revised|changed)\s+from\s+(?:Rs\.?|INR|₹)?\s*[\d.,\s]+?(?:lakh|lakhs)?\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);
    const spotDirect = s.match(/(?:the\s+)?spot\s+limit\s+(?:shall\s+be|is\s+set\s+to|is\s+raised\s+to|is\s+increased\s+to|is\s+reduced\s+to|is\s+changed\s+to|is)\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i) ||
      s.match(/(?:raise|set|change|increase|reduce)\s+(?:the\s+)?spot\s+limit\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);

    if (spotFromTo || spotDirect) {
      const valStr = spotFromTo ? spotFromTo[1] : spotDirect![1];
      const limit = parseLakh(valStr);
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

    // 5. Emergency limit change:
    // "The emergency limit is raised from Rs 5,00,000 to Rs 7,50,000", "The emergency limit shall be Rs 7,50,000"
    const emergFromTo = s.match(/(?:the\s+)?emergency\s+limit\s+(?:is|shall\s+be|has\s+been)?\s*(?:raised|increased|reduced|revised|changed)\s+from\s+(?:Rs\.?|INR|₹)?\s*[\d.,\s]+?(?:lakh|lakhs)?\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);
    const emergDirect = s.match(/(?:the\s+)?emergency\s+limit\s+(?:shall\s+be|is\s+set\s+to|is\s+raised\s+to|is\s+increased\s+to|is\s+reduced\s+to|is\s+changed\s+to|is)\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i) ||
      s.match(/(?:raise|set|change|increase|reduce)\s+(?:the\s+)?emergency\s+limit\s+to\s+(?:Rs\.?|INR|₹)?\s*([\d.,]+(?:\s*(?:lakh|lakhs|lac|lacs))?)/i);

    if (emergFromTo || emergDirect) {
      const valStr = emergFromTo ? emergFromTo[1] : emergDirect![1];
      const limit = parseLakh(valStr);
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

    // 6. Clubbing window:
    // "Clubbing window is changed from 14 to 10 days", "Clubbing window shall be 10 days", "change clubbing window to 10 days"
    const clubFromTo = s.match(/clubbing\s+(?:window\s+)?(?:is|shall\s+be|has\s+been)?\s*(?:raised|increased|reduced|changed)\s+from\s+\d+\s+days?\s+to\s+(\d+)\s+days?/i);
    const clubDirect = s.match(/clubbing\s+(?:window\s+)?(?:shall\s+be|is\s+set\s+to|is\s+changed\s+to|is)\s+(\d+)\s+days?/i) ||
      s.match(/(?:change|set|increase|reduce)\s+clubbing\s+(?:window\s+)?to\s+(\d+)\s+days?/i);

    if (clubFromTo || clubDirect) {
      const days = parseInt(clubFromTo ? clubFromTo[1] : clubDirect![1], 10);
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

    // 7. Consolidation window:
    // "Consolidation window is reduced from 24 hours to 12 hours", "Consolidation window shall be 48 hours", "change consolidation window to 48 hours"
    const consolFromTo = s.match(/consolidation\s+(?:window\s+)?(?:is|shall\s+be|has\s+been)?\s*(?:raised|increased|reduced|changed)\s+from\s+\d+\s+hours?\s+to\s+(\d+)\s+hours?/i);
    const consolDirect = s.match(/consolidation\s+(?:window\s+)?(?:shall\s+be|is\s+set\s+to|is\s+changed\s+to|is)\s+(\d+)\s+hours?/i) ||
      s.match(/(?:change|set|increase|reduce)\s+consolidation\s+(?:window\s+)?to\s+(\d+)\s+hours?/i);

    if (consolFromTo || consolDirect) {
      const hours = parseInt(consolFromTo ? consolFromTo[1] : consolDirect![1], 10);
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

    // 8. Force / Require RFQ for category:
    // "Require RFQ for Electrical Spares", "RFQ shall be mandatory for Electrical Spares"
    const forceRfqMatch =
      s.match(/(?:require|force)\s+RFQ\s+for\s+([A-Za-z\s]+)/i) ||
      s.match(/RFQ\s+shall\s+be\s+mandatory\s+for\s+([A-Za-z\s]+)/i);
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

    // 9. Ranking weights change:
    // "Ranking weight for frequency shall be 0.40", "Weight for frequency is changed from 0.30 to 0.40", "change frequency weight to 0.40"
    const weightFromTo = s.match(/(?:ranking\s+)?weight\s+for\s+(frequency|recency|contract|on_time|quality)\s+(?:is|has\s+been)?\s*(?:changed|raised|reduced)\s+from\s+[0-9.]+\s+to\s+([0-9.]+)/i);
    const weightDirect = s.match(/(?:ranking\s+)?weight\s+for\s+(frequency|recency|contract|on_time|quality)\s+(?:shall\s+be|is\s+set\s+to|is)\s+([0-9.]+)/i) ||
      s.match(/(?:change|set)\s+(?:ranking\s+)?(?:weight\s+for\s+)?(frequency|recency|contract|on_time|quality)\s+(?:weight\s+)?to\s+([0-9.]+)/i);

    if (weightFromTo || weightDirect) {
      const field = (weightFromTo ? weightFromTo[1] : weightDirect![1]).toLowerCase();
      const valStr = weightFromTo ? weightFromTo[2] : weightDirect![2];
      const weightVal = parseFloat(valStr);
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

    // 10. Supplier eligibility threshold:
    // "Minimum on-time shall be 90%", "Minimum on-time percentage is raised from 80% to 90%", "Require minimum on-time of 90%"
    const minOnTimeFromTo = s.match(/minimum\s+on-?time\s+(?:percentage\s+)?(?:is|has\s+been)?\s*(?:raised|increased|changed)\s+from\s+\d+%\s+to\s+(\d+)\s*%/i);
    const minOnTimeDirect = s.match(/minimum\s+on-?time\s+(?:percentage\s+)?(?:shall\s+be|is\s+set\s+to|is|to|of)?\s*(\d+)\s*%/i) ||
      s.match(/(?:set|require)\s+minimum\s+on-?time\s+(?:percentage\s+)?(?:to|of)?\s*(\d+)\s*%/i);

    if (minOnTimeFromTo || minOnTimeDirect) {
      const minPct = parseInt(minOnTimeFromTo ? minOnTimeFromTo[1] : minOnTimeDirect![1], 10);
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
  }

  // Fail loudly when zero operations are found
  if (operations.length === 0) {
    throw new Error(
      'No policy operations could be extracted from amendment text. Please use the structured form editor to specify your changes.'
    );
  }

  const effectiveFrom = parsedDate || basePolicy.effective_from || '2026-11-20';

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
