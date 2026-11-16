import { prisma } from '../prisma.js';
import {
  ItemMatcher,
  ChatSessionState,
  extractSlotsRuleBased,
  resolvePlantName,
  getCalendarDaysDiff,
  runDecisionEngine,
  PRLineInput,
} from '@cantill/engine';
import { loadEngineContext } from './data.service.js';
import { callGroqChat } from '../groq.js';
import { getActivePolicy } from './policy.service.js';

export async function getOrCreateChatSession(sessionId?: string, userName: string = 'Requester') {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (existing) return existing;
  }

  return prisma.chatSession.create({
    data: {
      user_name: userName,
      user_role: 'Requester',
      state_json: JSON.stringify({
        lines: [{}],
        active_line_index: 0,
        missing_slots: ['item', 'quantity', 'plant', 'need_by_date', 'urgency'],
        ready_to_confirm: false,
      }),
    },
  });
}

export async function processUserChatMessage(
  sessionId: string,
  userText: string
): Promise<{ reply: string; state: ChatSessionState; quickReplies?: string[]; prNumber?: string }> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new Error(`Chat session ${sessionId} not found`);
  }

  let state: ChatSessionState = {
    lines: [{}],
    active_line_index: 0,
    missing_slots: ['item', 'quantity', 'plant', 'need_by_date', 'urgency'],
    ready_to_confirm: false,
  };

  try {
    state = JSON.parse(session.state_json);
  } catch {}

  // Save user message to database
  await prisma.chatMessage.create({
    data: {
      session_id: sessionId,
      sender: 'user',
      text: userText,
    },
  });

  const context = await loadEngineContext();
  const matcher = new ItemMatcher(context.items);

  // Check if user confirmed the PR
  const lower = userText.trim().toLowerCase();
  if (state.ready_to_confirm && (lower.includes('confirm and submit') || lower === 'confirm')) {
    // 1. Generate next PR number using highest existing PR number + 1 to avoid collision with kit series
    const existingPRs = await prisma.pRLine.findMany({ select: { pr_no: true } });
    let maxNum = 0;
    for (const p of existingPRs) {
      const match = p.pr_no.match(/PR(?:-26)?-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextNum = maxNum + 1;
    const prNumber = `PR-26-${String(nextNum).padStart(5, '0')}`;

    // 2. Persist ALL lines in state.lines (supports multi-item messages without losing lines)
    const createdPRLines = [];
    const prLineInputs: PRLineInput[] = [];

    for (let i = 0; i < state.lines.length; i++) {
      const line = state.lines[i];
      const prLineNo = i + 1;
      const matchResult = matcher.match(line.item_code || '', line.description || '');

      const created = await prisma.pRLine.create({
        data: {
          id: `${prNumber}-${prLineNo}`,
          pr_no: prNumber,
          pr_line: prLineNo,
          input_index: i,
          requester: session.user_name,
          department: 'Operations',
          plant: line.plant || 'PUN1',
          input_item_code: line.item_code !== 'NEW' ? line.item_code : undefined,
          resolved_item_code: matchResult.resolved_item_code,
          description: line.description || matchResult.matched_item?.description || '',
          quantity: line.quantity || 1,
          uom: line.uom || matchResult.matched_item?.uom || 'NOS',
          estimated_unit_price: line.estimated_unit_price || null,
          need_by_date: line.need_by_date || new Date().toISOString().slice(0, 10),
          urgency: line.urgency || 'Normal',
          match_method: matchResult.match_method,
          match_confidence: matchResult.match_confidence,
          flags: JSON.stringify(matchResult.flags || []),
          status: 'open',
        },
      });
      createdPRLines.push(created);

      prLineInputs.push({
        pr_no: prNumber,
        pr_line: prLineNo,
        created_at: created.created_at.toISOString(),
        requester: created.requester,
        department: created.department,
        plant: created.plant,
        item_code: created.resolved_item_code,
        description: created.description,
        quantity: created.quantity,
        uom: created.uom,
        estimated_unit_price: created.estimated_unit_price || undefined,
        need_by_date: created.need_by_date,
        urgency: created.urgency,
      });
    }

    // 3. Run decision engine on newly created lines so Chat PRs reach the buyer queue
    const engineResult = runDecisionEngine(prLineInputs, context);

    const run = await prisma.decisionRun.create({
      data: {
        batch_id: null,
        policy_version: engineResult.summary.policyVersionsUsed[0] || '5.0',
        total_requirements: engineResult.requirements.length,
      },
    });

    for (const req of engineResult.requirements) {
      const scopedReqId = `${run.id}_${req.group_id}`;
      await prisma.requirement.upsert({
        where: { id: scopedReqId },
        create: {
          id: scopedReqId,
          run_id: run.id,
          batch_id: null,
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
          contract_id: req.decision?.contract_id,
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
          flags: JSON.stringify(req.decision?.flags || req.flags || []),
          status: 'pending',
        },
      });

      // Link lines to requirement
      for (const l of req.lines) {
        await prisma.pRLine.updateMany({
          where: { pr_no: l.pr_no, pr_line: l.pr_line },
          data: { requirement_id: scopedReqId, status: 'grouped' },
        });

        await prisma.requirementLine.create({
          data: {
            requirement_id: scopedReqId,
            pr_line_id: `${l.pr_no}-${l.pr_line}`,
            quantity: l.quantity,
            uom: l.uom,
          },
        });
      }
    }

    // Persist consolidated POs if any
    for (const po of engineResult.consolidatedPOs) {
      const scopedPoId = `${run.id}_${po.po_id}`;
      await prisma.purchaseOrder.upsert({
        where: { id: scopedPoId },
        create: {
          id: scopedPoId,
          run_id: run.id,
          batch_id: null,
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

    const lineSummary = createdPRLines
      .map((l) => `• Line ${l.pr_line}: ${l.quantity} ${l.uom} of ${l.resolved_item_code} (${l.description})`)
      .join('\n');

    const successMessage = `Requisition submitted successfully!\n\nYour Purchase Request number is **${prNumber}** with ${createdPRLines.length} item line(s):\n${lineSummary}\n\nWhat happens next:\n1. Your request has entered the procurement decision engine and appears in the Buyer Queue.\n2. Automated clubbing and contract evaluation have been performed.\n3. Track progress in the Buyer Queue or Requester portal.`;

    // Reset session state
    const resetState: ChatSessionState = {
      lines: [{}],
      active_line_index: 0,
      missing_slots: ['item', 'quantity', 'plant', 'need_by_date', 'urgency'],
      ready_to_confirm: false,
    };

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { state_json: JSON.stringify(resetState) },
    });

    await prisma.chatMessage.create({
      data: {
        session_id: sessionId,
        sender: 'assistant',
        text: successMessage,
      },
    });

    return {
      reply: successMessage,
      state: resetState,
      prNumber,
      quickReplies: ['Raise another requisition', 'View my PRs'],
    };
  }

  // Check LLM path with callGroqChat if configured
  let llmHandled = false;
  let response = '';
  let updatedState = state;
  let quickReplies: string[] | undefined = undefined;

  if (!state.ready_to_confirm) {
    const groqPrompt = `You are Corvo Engineering's Requisition Intake Assistant.
Plants: PUN1 (Bhosari plant), CHK1 (Chakan plant).
Valid urgency: Normal, Emergency.
Current Draft State:
${JSON.stringify(state, null, 2)}

User said: "${userText}"

Extract line items and missing slots (item name/code, quantity, plant, need_by_date in YYYY-MM-DD or relative like next Friday, urgency).
Return JSON ONLY:
{
  "reply": string (polite professional response asking for missing info or confirming details),
  "lines": Array of { item_code?, description?, quantity?, uom?, plant?, need_by_date?, urgency?, estimated_unit_price? },
  "ready_to_confirm": boolean (true only if ALL lines have item, quantity > 0, valid plant, need_by_date, urgency),
  "quickReplies": string[]
}`;

    const groqRes = await callGroqChat(
      [
        { role: 'system', content: 'You are an intelligent procurement assistant extracting requisition line items into JSON.' },
        { role: 'user', content: groqPrompt },
      ],
      true
    );

    if (groqRes) {
      try {
        const parsed = JSON.parse(groqRes);
        if (parsed.reply && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          response = parsed.reply;
          updatedState = {
            lines: parsed.lines,
            active_line_index: 0,
            missing_slots: parsed.ready_to_confirm ? [] : ['Check line details'],
            ready_to_confirm: !!parsed.ready_to_confirm,
          };
          quickReplies = parsed.quickReplies;
          llmHandled = true;
        }
      } catch (e) {
        console.warn('Groq chat extraction failed, falling back to rule-based extractor:', e);
      }
    }
  }

  if (!llmHandled) {
    // Deterministic rule-based slot extraction
    const ruleRes = extractSlotsRuleBased(userText, matcher, state);
    response = ruleRes.response;
    updatedState = ruleRes.updatedState;
    quickReplies = ruleRes.quickReplies;
  }

  // Check clubbing transparency strictly with 14-day creation and 7-day need-by windows
  const activeLine = updatedState.lines[updatedState.active_line_index];
  if (activeLine && activeLine.item_code && activeLine.plant && !updatedState.clubbing_notice) {
    const activePolicy = await getActivePolicy();
    const clubCreatedDays = activePolicy.params.club_created_within_days ?? 14;
    const clubNeedByDays = activePolicy.params.club_need_by_within_days ?? 7;

    const candidateLines = await prisma.pRLine.findMany({
      where: {
        resolved_item_code: activeLine.item_code,
        plant: activeLine.plant,
        status: { in: ['open', 'grouped'] },
      },
      orderBy: { created_at: 'desc' },
    });

    const now = new Date();
    const draftNeedBy = activeLine.need_by_date ? new Date(activeLine.need_by_date) : null;

    const similar = candidateLines.find((c) => {
      // 14-day creation window: created_at within clubCreatedDays
      const createdDaysDiff = Math.abs(getCalendarDaysDiff(now, c.created_at));
      if (createdDaysDiff > clubCreatedDays) return false;

      // 7-day need-by window: need_by_date within clubNeedByDays
      if (draftNeedBy && c.need_by_date) {
        const needByDaysDiff = Math.abs(getCalendarDaysDiff(draftNeedBy, new Date(c.need_by_date)));
        if (needByDaysDiff > clubNeedByDays) return false;
      }
      return true;
    });

    if (similar) {
      updatedState.clubbing_notice = `Anti-Splitting Notice: A similar open request (${similar.pr_no}, ${similar.quantity} ${similar.uom}, needed by ${similar.need_by_date}) exists within the ${clubCreatedDays}-day creation window and ${clubNeedByDays}-day need-by window at plant ${similar.plant}. Procurement policy will treat them as one combined requirement to leverage volume pricing.`;
    }
  }

  // Update session state in DB
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { state_json: JSON.stringify(updatedState) },
  });

  let fullReply = response;
  if (updatedState.clubbing_notice && updatedState.ready_to_confirm) {
    fullReply = `${updatedState.clubbing_notice}\n\n${response}`;
  }

  // Save assistant reply in DB
  await prisma.chatMessage.create({
    data: {
      session_id: sessionId,
      sender: 'assistant',
      text: fullReply,
      metadata: quickReplies ? JSON.stringify({ quickReplies }) : null,
    },
  });

  return {
    reply: fullReply,
    state: updatedState,
    quickReplies,
  };
}
