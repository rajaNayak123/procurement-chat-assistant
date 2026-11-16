import Fuse from 'fuse.js';
import { ItemMaster } from './types.js';

export interface MatchResult {
  resolved_item_code: string; // Matched item code or "NEW"
  is_new: boolean;
  match_method: 'code_exact' | 'description_exact' | 'abbreviation' | 'token_fuzzy' | 'new_item';
  match_confidence: number; // 0 to 1
  flags: string[];
  matched_item?: ItemMaster;
  alternatives?: Array<{ item: ItemMaster; score: number }>;
}

export const ABBREVIATIONS: Record<string, string> = {
  'brg': 'bearing',
  'hyd': 'hydraulic',
  'pneu': 'pneumatic',
  'rod': 'electrode',
  'welding rod': 'welding electrode',
  'ss': 'stainless steel',
  'mtr': 'meter',
  'ltr': 'liter',
  'lph': 'lph',
  'pcs': 'pieces',
  'nos': 'nos',
  'pkg': 'packaging',
  'elec': 'electrical',
};

export const NOISE_PHRASES = [
  'urgent',
  'urgently',
  'repeat',
  'repeat order',
  'as per sample',
  'for maintenance',
  'asap',
  'please',
  'reqd',
  'required',
  'broken',
  'immediate',
];

export function extractNumericTokens(text: string): string[] {
  // Extract number tokens or alphanumeric part tokens like 6308, 6205, 24, 50, M16x60, 2RS, ZZ
  const tokens = text.match(/\b([A-Za-z]?\d+[A-Za-z0-9_-]*|\d+)\b/g) || [];
  return tokens.map((t) => t.toLowerCase().replace(/[-_]/g, ''));
}

export function normalizeDescription(text: string): string {
  if (!text) return '';
  let norm = text.toLowerCase();

  // Convert 24" or 24 ' to 24 inch
  norm = norm.replace(/(\d+)\s*["”]/g, '$1 inch ');
  norm = norm.replace(/(\d+)\s*'/g, '$1 feet ');

  // Strip noise phrases
  for (const noise of NOISE_PHRASES) {
    const regex = new RegExp(`\\b${noise}\\b`, 'gi');
    norm = norm.replace(regex, ' ');
  }

  // Replace punctuation except hyphen in part numbers
  norm = norm.replace(/[(),;:[\]]/g, ' ');

  // Replace known multi-word abbreviations
  if (norm.includes('welding rod')) {
    norm = norm.replace(/welding rod/g, 'welding electrode');
  }

  // Tokenize and replace single-word abbreviations
  const tokens = norm.split(/\s+/).filter(Boolean);
  const expanded = tokens.map((t) => {
    const cleanT = t.replace(/^[-_.]+|[-_.]+$/g, '');
    return ABBREVIATIONS[cleanT] || t;
  });

  return expanded.join(' ').trim();
}

export class ItemMatcher {
  private itemsByCode: Map<string, ItemMaster>;
  private itemsByDesc: Map<string, ItemMaster>;
  private fuse: Fuse<ItemMaster>;

  constructor(private items: ItemMaster[]) {
    this.itemsByCode = new Map(items.map((i) => [i.item_code.toUpperCase(), i]));
    this.itemsByDesc = new Map(
      items.map((i) => [normalizeDescription(i.description), i])
    );

    this.fuse = new Fuse(items, {
      keys: ['description', 'category'],
      includeScore: true,
      threshold: 0.5,
      ignoreLocation: true,
    });
  }

  public match(code?: string, rawDesc?: string): MatchResult {
    const flags: string[] = [];

    // 1. If item code is provided
    if (code && code.trim().length > 0) {
      const cleanCode = code.trim().toUpperCase();
      const existing = this.itemsByCode.get(cleanCode);
      if (existing) {
        return {
          resolved_item_code: existing.item_code,
          is_new: false,
          match_method: 'code_exact',
          match_confidence: 1.0,
          flags,
          matched_item: existing,
        };
      } else {
        flags.push(`Unknown item code ${code}; falling back to description match`);
      }
    }

    const desc = rawDesc?.trim() || '';
    if (!desc) {
      return {
        resolved_item_code: 'NEW',
        is_new: true,
        match_method: 'new_item',
        match_confidence: 0,
        flags: ['Empty description and code'],
      };
    }

    const normQuery = normalizeDescription(desc);
    const queryNumbers = extractNumericTokens(normQuery);

    // 2. Direct exact normalized description match
    const exactDescMatch = this.itemsByDesc.get(normQuery);
    if (exactDescMatch) {
      return {
        resolved_item_code: exactDescMatch.item_code,
        is_new: false,
        match_method: 'description_exact',
        match_confidence: 1.0,
        flags,
        matched_item: exactDescMatch,
      };
    }

    // 3. Token containment and scoring across all catalog items
    let bestCandidate: ItemMaster | null = null;
    let highestScore = -1;
    const alternatives: Array<{ item: ItemMaster; score: number }> = [];

    const queryWords = normQuery.split(/\s+/).filter(Boolean);

    for (const item of this.items) {
      const itemNorm = normalizeDescription(item.description);
      const itemNumbers = extractNumericTokens(itemNorm);

      // Part-number constraint: if query contains distinct specific numeric/part tokens,
      // they must be compatible with candidate's numbers. E.g. query 6205 cannot match 6308.
      if (queryNumbers.length > 0) {
        const querySignificantNums = queryNumbers.filter((n) => n.length >= 3 || !isNaN(Number(n)));
        if (querySignificantNums.length > 0) {
          const hasConflict = querySignificantNums.some(
            (qn) => itemNumbers.length > 0 && !itemNumbers.some((inm) => inm.includes(qn) || qn.includes(inm))
          );
          if (hasConflict) {
            continue; // Skip candidate with conflicting part number
          }
        }
      }

      const itemWords = itemNorm.split(/\s+/).filter(Boolean);

      // Token overlap
      let matches = 0;
      for (const qw of queryWords) {
        if (itemWords.some((iw) => iw.includes(qw) || qw.includes(iw))) {
          matches++;
        }
      }

      const recall = queryWords.length > 0 ? matches / queryWords.length : 0;
      const precision = itemWords.length > 0 ? matches / itemWords.length : 0;
      const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

      // Bonus if part numbers match exactly
      let score = f1;
      if (queryNumbers.length > 0 && queryNumbers.every((qn) => itemNumbers.includes(qn))) {
        score = Math.min(1.0, score + 0.3);
      }

      if (score > 0.4) {
        alternatives.push({ item, score });
      }

      if (score > highestScore) {
        highestScore = score;
        bestCandidate = item;
      }
    }

    // Sort alternatives descending
    alternatives.sort((a, b) => b.score - a.score);

    // Threshold decisions:
    // Confident match: >= 0.70
    if (bestCandidate && highestScore >= 0.70) {
      return {
        resolved_item_code: bestCandidate.item_code,
        is_new: false,
        match_method: highestScore >= 0.85 ? 'abbreviation' : 'token_fuzzy',
        match_confidence: parseFloat(highestScore.toFixed(2)),
        flags,
        matched_item: bestCandidate,
        alternatives: alternatives.slice(1, 4),
      };
    }

    // Medium confidence match (0.50 to 0.70): resolve to best, but flag "verify match"
    if (bestCandidate && highestScore >= 0.50) {
      flags.push('verify match: medium-confidence item match');
      return {
        resolved_item_code: bestCandidate.item_code,
        is_new: false,
        match_method: 'token_fuzzy',
        match_confidence: parseFloat(highestScore.toFixed(2)),
        flags,
        matched_item: bestCandidate,
        alternatives: alternatives.slice(1, 4),
      };
    }

    // Low confidence / No plausible candidate -> NEW item
    return {
      resolved_item_code: 'NEW',
      is_new: true,
      match_method: 'new_item',
      match_confidence: highestScore > 0 ? parseFloat(highestScore.toFixed(2)) : 0,
      flags,
      alternatives: alternatives.slice(0, 3),
    };
  }
}
