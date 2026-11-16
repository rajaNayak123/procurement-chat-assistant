import { prisma } from '../prisma.js';
import { callGroqChat } from '../groq.js';
import { parseIndianNumber } from '../utils/indianFormat.js';

export interface ExtractedContractData {
  contract_id: string;
  supplier_id: string;
  supplier_name: string;
  start_date: string;
  end_date: string;
  value_cap: number;
  lines: Array<{
    item_code: string;
    description: string;
    uom: string;
    rate: number;
  }>;
  raw_text: string;
  extraction_method: 'regex' | 'llm';
  warnings: string[];
}

export function extractContractFromTextRegex(text: string): ExtractedContractData | null {
  const warnings: string[] = [];

  // Match contract number: "Contract No. RC-..."
  const idMatch = text.match(/Contract\s+No\.?\s*:\s*([A-Z0-9-]+)/i) ||
                  text.match(/\b(RC-20\d{2}-\d{3})\b/);
  const contractId = idMatch ? idMatch[1] : '';

  // Match supplier ID: "(Supplier ID S0xx)"
  const supIdMatch = text.match(/\(Supplier\s+ID\s+([A-Z0-9]+)\)/i) ||
                     text.match(/\b(S\d{3})\b/);
  const supplierId = supIdMatch ? supIdMatch[1] : '';

  // Match supplier name: e.g. between "between Corvo Engineering and ..."
  const nameMatch = text.match(/between\s+Corvo\s+Engineering\s+(?:Private\s+Limited\s+)?and\s+([A-Za-z0-9\s.,&-]+?)(?:\s*\()/i);
  const supplierName = nameMatch ? nameMatch[1].trim() : '';

  // Match dates: "valid from YYYY-MM-DD to YYYY-MM-DD"
  const dateMatch = text.match(/valid\s+from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
  const startDate = dateMatch ? dateMatch[1] : '';
  const endDate = dateMatch ? dateMatch[2] : '';

  // Match ceiling: "shall not exceed INR 20,00,000" or similar
  const ceilingMatch = text.match(/shall\s+not\s+exceed\s+INR\s+([\d,]+(?:\.\d+)?)/i) ||
                       text.match(/ceiling\s+of\s+INR\s+([\d,]+(?:\.\d+)?)/i);
  const valueCap = ceilingMatch ? parseIndianNumber(ceilingMatch[1]) : 0;

  // Extract lines from Schedule A:
  // Table columns: # | Item code | Description | UoM | Rate (INR)
  // E.g.: "1 | ITM-1036 | ... | NOS | 3,537.76"
  const lines: ExtractedContractData['lines'] = [];
  const lineRegex = /(?:^|\n)\s*\d+\s*\|\s*(ITM-\d{4})\s*\|\s*([^|]+)\s*\|\s*([A-Za-z]+)\s*\|\s*([\d,]+(?:\.\d+)?)/gi;

  let m;
  while ((m = lineRegex.exec(text)) !== null) {
    const itemCode = m[1].trim();
    const desc = m[2].trim();
    const uom = m[3].trim();
    const rate = parseIndianNumber(m[4]);
    lines.push({
      item_code: itemCode,
      description: desc,
      uom,
      rate,
    });
  }

  if (!contractId || !supplierId || !startDate || !endDate || valueCap === 0) {
    return null;
  }

  return {
    contract_id: contractId,
    supplier_id: supplierId,
    supplier_name: supplierName,
    start_date: startDate,
    end_date: endDate,
    value_cap: valueCap,
    lines,
    raw_text: text,
    extraction_method: 'regex',
    warnings,
  };
}

export async function extractContractFromText(text: string): Promise<ExtractedContractData> {
  // 1. Try Regex first
  const regexResult = extractContractFromTextRegex(text);
  if (regexResult && regexResult.lines.length > 0) {
    return regexResult;
  }

  // 2. Fall back to LLM (Groq)
  const prompt = `You are extracting structured contract metadata from a procurement contract text.
Text:
"""${text}"""

Return JSON in this format:
{
  "contract_id": string,
  "supplier_id": string,
  "supplier_name": string,
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "value_cap": number,
  "lines": [
    { "item_code": string, "description": string, "uom": string, "rate": number }
  ]
}`;

  const llmResp = await callGroqChat(
    [
      { role: 'system', content: 'You extract contract fields into JSON.' },
      { role: 'user', content: prompt },
    ],
    true
  );

  if (llmResp) {
    try {
      const parsed = JSON.parse(llmResp);
      return {
        ...parsed,
        raw_text: text,
        extraction_method: 'llm',
        warnings: [],
      };
    } catch {}
  }

  // If both fail, return partial regexResult or empty scaffold
  return regexResult || {
    contract_id: '',
    supplier_id: '',
    supplier_name: '',
    start_date: '',
    end_date: '',
    value_cap: 0,
    lines: [],
    raw_text: text,
    extraction_method: 'regex',
    warnings: ['Could not extract all required fields from contract text.'],
  };
}
