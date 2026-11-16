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
    batchId?: string;
    policy_version?: string;
    as_of_policy?: 'requirement_date' | 'force' | string;
  } = {}
): Promise<EngineExecutionResult & { batchId?: string; runId?: string }> {
  // If as_of_policy is force without explicit policy_version, use latest active policy
  let forcedVersion = options.policy_version;
  if (options.as_of_policy === 'force' && !forcedVersion) {
    const active = await prisma.policyVersion.findFirst({
      where: { status: { in: ['approved', 'active'] } },
      orderBy: { effective_from: 'desc' },
    });
    if (active) forcedVersion = active.version;
  }

  const context = await loadEngineContext(forcedVersion);
  const result = runDecisionEngine(inputLines, context);

  let batchId: string | undefined = options.batchId;
  let runId: string | undefined = undefined;

  if (options.persist) {
    batchId = batchId || `BATCH-${Date.now()}`;
    const fileName = options.fileName || 'uploaded_batch.csv';

    // 1. Create or update batch record
    await prisma.pRBatch.upsert({
      where: { id: batchId },
      create: {
        id: batchId,
        file_name: fileName,
        total_lines: inputLines.length,
        status: 'processed',
      },
      update: {
        total_lines: inputLines.length,
        status: 'processed',
      },
    });

    // 2. Create DecisionRun record to scope requirements and POs
    const appliedPolicy =
      result.summary.policyVersionsUsed[0] || context.policy_versions[0]?.version || '5.0';
    const run = await prisma.decisionRun.create({
      data: {
        batch_id: batchId,
        policy_version: appliedPolicy,
        total_requirements: result.requirements.length,
      },
    });
    runId = run.id;

    // Lookup mapping for processed lines
    const lineToReqByIndex = new Map<number, { req: (typeof result.requirements)[0]; line: any }>();
    const lineToReqMap = new Map<string, { req: (typeof result.requirements)[0]; line: any }>();
    for (const req of result.requirements) {
      for (const line of req.lines) {
        if (line.input_index !== undefined) {
          lineToReqByIndex.set(line.input_index, { req, line });
        }
        lineToReqMap.set(`${line.pr_no}:${line.pr_line}`, { req, line });
      }
    }

    // 3. Persist ALL PR lines in original input order, including NOT_PROCESSED
    for (let index = 0; index < inputLines.length; index++) {
      const raw = inputLines[index];
      const prNo = String(raw.pr_no || '').trim();
      const prLine =
        typeof raw.pr_line === 'number'
          ? raw.pr_line
          : parseInt(String(raw.pr_line || index + 1), 10) || index + 1;
      const rawCreatedAt = String(raw.created_at || '').trim();
      const parsedCreatedAt =
        rawCreatedAt && !isNaN(new Date(rawCreatedAt).getTime())
          ? new Date(rawCreatedAt)
          : new Date();

      const outputRow = result.outputRows[index];
      const matched =
        lineToReqByIndex.get(index) ??
        (outputRow?.route !== 'NOT_PROCESSED' ? lineToReqMap.get(`${prNo}:${prLine}`) : undefined);
      const isNotProcessed = outputRow?.route === 'NOT_PROCESSED' || !matched;
      const lineDbId = `${batchId}_line_${index}`;

      if (!isNotProcessed && matched) {
        const scopedReqId = `${run.id}_${matched.req.group_id}`;
        await prisma.pRLine.upsert({
          where: { id: lineDbId },
          create: {
            id: lineDbId,
            batch_id: batchId,
            input_index: index,
            pr_no: prNo,
            pr_line: prLine,
            created_at: parsedCreatedAt,
            raw_created_at: rawCreatedAt,
            raw_json: JSON.stringify(raw),
            requester: String(raw.requester || '').trim(),
            department: String(raw.department || '').trim(),
            plant: String(raw.plant || '').trim(),
            input_item_code: raw.item_code ? String(raw.item_code).trim() : null,
            resolved_item_code: matched.line.resolved_item_code,
            description: String(raw.description || '').trim(),
            quantity:
              typeof raw.quantity === 'number'
                ? raw.quantity
                : parseFloat(String(raw.quantity || 0)) || 0,
            uom: String(raw.uom || 'NOS').trim(),
            estimated_unit_price: raw.estimated_unit_price
              ? parseFloat(String(raw.estimated_unit_price))
              : null,
            need_by_date: String(raw.need_by_date || '').trim(),
            urgency: String(raw.urgency || 'Normal').trim(),
            match_method: matched.line.match_method,
            match_confidence: matched.line.match_confidence,
            flags: JSON.stringify(matched.line.flags || []),
            status: 'grouped',
            requirement_id: scopedReqId,
          },
          update: {
            input_index: index,
            created_at: parsedCreatedAt,
            raw_created_at: rawCreatedAt,
            raw_json: JSON.stringify(raw),
            requirement_id: scopedReqId,
            resolved_item_code: matched.line.resolved_item_code,
            status: 'grouped',
            flags: JSON.stringify(matched.line.flags || []),
          },
        });
      } else {
        // NOT_PROCESSED line: must be saved so row count and input order are preserved
        await prisma.pRLine.upsert({
          where: { id: lineDbId },
          create: {
            id: lineDbId,
            batch_id: batchId,
            input_index: index,
            pr_no: prNo,
            pr_line: prLine,
            created_at: parsedCreatedAt,
            raw_created_at: rawCreatedAt,
            raw_json: JSON.stringify(raw),
            requester: String(raw.requester || '').trim(),
            department: String(raw.department || '').trim(),
            plant: String(raw.plant || '').trim(),
            input_item_code: raw.item_code ? String(raw.item_code).trim() : null,
            resolved_item_code: raw.item_code ? String(raw.item_code).trim() : 'NEW',
            description: String(raw.description || '').trim(),
            quantity:
              typeof raw.quantity === 'number'
                ? raw.quantity
                : parseFloat(String(raw.quantity || 0)) || 0,
            uom: String(raw.uom || 'NOS').trim(),
            estimated_unit_price: raw.estimated_unit_price
              ? parseFloat(String(raw.estimated_unit_price))
              : null,
            need_by_date: String(raw.need_by_date || '').trim(),
            urgency: String(raw.urgency || 'Normal').trim(),
            match_method: 'none',
            match_confidence: 0,
            flags: '[]',
            status: 'not_processed',
            requirement_id: null,
            error_reason: outputRow?.reason || 'Invalid line',
          },
          update: {
            input_index: index,
            created_at: parsedCreatedAt,
            raw_created_at: rawCreatedAt,
            raw_json: JSON.stringify(raw),
            status: 'not_processed',
            requirement_id: null,
            error_reason: outputRow?.reason || 'Invalid line',
          },
        });
      }
    }

    // 4. Persist Requirements (scoped to DecisionRun: ${run.id}_${req.group_id})
    for (const req of result.requirements) {
      const scopedReqId = `${run.id}_${req.group_id}`;
      await prisma.requirement.upsert({
        where: { id: scopedReqId },
        create: {
          id: scopedReqId,
          run_id: run.id,
          batch_id: batchId,
          group_id: req.group_id,
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
          contract_id: req.decision?.contract_id || null,
          suggested_suppliers: req.decision?.suggested_supplier_ids.join(';'),
          policy_version: req.decision?.policy_version,
          clause: req.decision?.clause,
          reason: req.decision?.reason,
          po_id: req.decision?.po_id || null,
          flags: JSON.stringify(req.decision?.flags || req.flags || []),
          rule_trace: JSON.stringify(req.decision?.rule_trace),
          status: 'pending',
        },
        update: {
          decision: req.decision?.decision,
          route: req.decision?.route,
          supplier_id: req.decision?.supplier_id,
          contract_id: req.decision?.contract_id || null,
          po_unit_price: req.decision?.po_unit_price,
          suggested_suppliers: req.decision?.suggested_supplier_ids.join(';'),
          policy_version: req.decision?.policy_version,
          clause: req.decision?.clause,
          reason: req.decision?.reason,
          po_id: req.decision?.po_id || null,
          flags: JSON.stringify(req.decision?.flags || req.flags || []),
          rule_trace: JSON.stringify(req.decision?.rule_trace),
        },
      });

      // Persist RequirementLine records linking requirement to PR lines
      for (const line of req.lines) {
        const matchingIndex = inputLines.findIndex(
          (l) => String(l.pr_no).trim() === line.pr_no && Number(l.pr_line) === line.pr_line
        );
        const lineDbId = matchingIndex >= 0 ? `${batchId}_line_${matchingIndex}` : `${line.pr_no}-${line.pr_line}`;
        await prisma.requirementLine.create({
          data: {
            requirement_id: scopedReqId,
            pr_line_id: lineDbId,
            quantity: line.quantity,
            uom: line.uom,
          },
        });
      }
    }

    // 5. Persist Consolidated POs (scoped to DecisionRun: ${run.id}_${po.po_id})
    for (const po of result.consolidatedPOs) {
      const scopedPoId = `${run.id}_${po.po_id}`;
      await prisma.purchaseOrder.upsert({
        where: { id: scopedPoId },
        create: {
          id: scopedPoId,
          run_id: run.id,
          batch_id: batchId,
          po_id: po.po_id,
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

  return { ...result, batchId, runId };
}
