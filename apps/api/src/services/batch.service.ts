import { parse } from 'csv-parse/sync';
import { prisma } from '../prisma.js';
import {
  PRLineInput,
  runDecisionEngine,
  EngineExecutionResult,
} from '@cantill/engine';
import { loadEngineContext } from './data.service.js';

export function parsePRBatchCSV(content: string): PRLineInput[] {
  // Strip UTF-8 BOM if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xfeff) {
    cleanContent = cleanContent.slice(1);
  }

  const records = parse(cleanContent, {
    columns: (header: string[]) =>
      header.map((col) => col.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  return records.map((r: any) => {
    // Map common header variations
    const prNo = r.pr_no || r.pr_number || r.pr || '';
    const prLine = r.pr_line || r.line_no || r.line || 1;
    const createdAt = r.created_at || r.creation_date || r.date || new Date().toISOString();
    const requester = r.requester || r.requested_by || '';
    const department = r.department || r.dept || '';
    const plant = r.plant || r.factory || '';
    const itemCode = r.item_code || r.item || undefined;
    const description = r.description || r.item_description || '';
    const quantity = r.quantity || r.qty || 0;
    const uom = r.uom || r.unit || 'NOS';
    const estimatedPrice = r.estimated_unit_price || r.estimated_price || r.unit_price || null;
    const needByDate = r.need_by_date || r.need_by || r.required_by || '';
    const urgency = r.urgency || 'Normal';

    return {
      pr_no: String(prNo).trim(),
      pr_line: prLine,
      created_at: String(createdAt).trim(),
      requester: String(requester).trim(),
      department: String(department).trim(),
      plant: String(plant).trim(),
      item_code: itemCode ? String(itemCode).trim() : undefined,
      description: String(description).trim(),
      quantity,
      uom: String(uom).trim(),
      estimated_unit_price: estimatedPrice,
      need_by_date: String(needByDate).trim(),
      urgency: String(urgency).trim(),
    };
  });
}

export async function processBatch(
  inputLines: PRLineInput[],
  options: {
    fileName?: string;
    persist?: boolean;
    policy_version?: string;
  } = {}
): Promise<EngineExecutionResult & { batchId?: string }> {
  const context = await loadEngineContext(options.policy_version);
  const result = runDecisionEngine(inputLines, context);

  let batchId: string | undefined = undefined;

  if (options.persist) {
    batchId = `BATCH-${Date.now()}`;
    const fileName = options.fileName || 'uploaded_batch.csv';

    // 1. Create batch record
    await prisma.pRBatch.create({
      data: {
        id: batchId,
        file_name: fileName,
        total_lines: inputLines.length,
        status: 'processed',
      },
    });

    // 2. Persist PR lines
    for (const req of result.requirements) {
      for (const line of req.lines) {
        await prisma.pRLine.upsert({
          where: { id: `${line.pr_no}-${line.pr_line}` },
          create: {
            id: `${line.pr_no}-${line.pr_line}`,
            batch_id: batchId,
            pr_no: line.pr_no,
            pr_line: line.pr_line,
            requester: line.requester,
            department: line.department,
            plant: line.plant,
            input_item_code: line.input_item_code,
            resolved_item_code: line.resolved_item_code,
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            estimated_unit_price: line.estimated_unit_price,
            need_by_date: line.need_by_date,
            urgency: line.urgency,
            match_method: line.match_method,
            match_confidence: line.match_confidence,
            flags: JSON.stringify(line.flags),
            requirement_id: req.group_id,
            status: 'grouped',
          },
          update: {
            batch_id: batchId,
            quantity: line.quantity,
            need_by_date: line.need_by_date,
            requirement_id: req.group_id,
          },
        });
      }
    }

    // 3. Persist Requirements
    for (const req of result.requirements) {
      await prisma.requirement.upsert({
        where: { id: req.group_id },
        create: {
          id: req.group_id,
          item_code: req.item_code,
          plant: req.plant,
          requirement_date: req.requirement_date,
          need_by_date: req.need_by_date,
          total_quantity: req.total_quantity,
          uom: req.uom,
          valuation_price: req.valuation_price,
          valuation_source: req.valuation_source,
          valuation_ref: req.valuation_ref,
          group_value_inr: req.group_value_inr,
          decision: req.decision?.decision,
          route: req.decision?.route,
          supplier_id: req.decision?.supplier_id,
          po_unit_price: req.decision?.po_unit_price,
          suggested_suppliers: req.decision?.suggested_supplier_ids.join(';'),
          policy_version: req.decision?.policy_version,
          clause: req.decision?.clause,
          reason: req.decision?.reason,
          po_id: req.decision?.po_id,
          rule_trace: JSON.stringify(req.decision?.rule_trace),
          status: 'pending',
        },
        update: {
          decision: req.decision?.decision,
          route: req.decision?.route,
          supplier_id: req.decision?.supplier_id,
          po_unit_price: req.decision?.po_unit_price,
          suggested_suppliers: req.decision?.suggested_supplier_ids.join(';'),
          policy_version: req.decision?.policy_version,
          clause: req.decision?.clause,
          reason: req.decision?.reason,
          po_id: req.decision?.po_id,
          rule_trace: JSON.stringify(req.decision?.rule_trace),
        },
      });
    }

    // 4. Persist Consolidated POs
    for (const po of result.consolidatedPOs) {
      await prisma.purchaseOrder.upsert({
        where: { id: po.po_id },
        create: {
          id: po.po_id,
          supplier_id: po.supplier_id,
          plant: po.plant,
          route: po.route,
          total_value: po.total_value,
          status: 'created',
        },
        update: {
          total_value: po.total_value,
        },
      });
    }
  }

  return { ...result, batchId };
}
