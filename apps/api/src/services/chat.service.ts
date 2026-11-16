import { prisma } from '../prisma.js';
import {
  ItemMatcher,
  ChatSessionState,
  extractSlotsRuleBased,
  resolvePlantName,
} from '@cantill/engine';
import { loadEngineContext } from './data.service.js';
import { callGroqChat } from '../groq.js';

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
    // Generate next PR number: PR-26-XXXXX
    const count = await prisma.pRLine.count();
    const prNumber = `PR-26-${String(count + 1).padStart(5, '0')}`;
    const line = state.lines[state.active_line_index];

    // Save PR line to DB
    await prisma.pRLine.create({
      data: {
        id: `${prNumber}-1`,
        pr_no: prNumber,
        pr_line: 1,
        requester: session.user_name,
        department: 'Operations',
        plant: line.plant || 'PUN1',
        input_item_code: line.item_code !== 'NEW' ? line.item_code : undefined,
        resolved_item_code: line.item_code || 'NEW',
        description: line.description || '',
        quantity: line.quantity || 1,
        uom: line.uom || 'NOS',
        estimated_unit_price: line.estimated_unit_price || null,
        need_by_date: line.need_by_date || new Date().toISOString().slice(0, 10),
        urgency: line.urgency || 'Normal',
        match_method: line.is_new ? 'new_item' : 'code_exact',
        match_confidence: 1.0,
        flags: '[]',
        status: 'open',
      },
    });

    const successMessage = `Requisition submitted successfully!\n\nYour Purchase Request number is **${prNumber}**.\n\nWhat happens next:\n1. Your request joins the procurement decision pipeline.\n2. The policy engine will check contracts and thresholds to either place a Purchase Order or issue a Sourcing Request.\n3. You can track progress in your Requester portal.`;

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

  // Deterministic slot extraction
  const { response, updatedState, quickReplies } = extractSlotsRuleBased(
    userText,
    matcher,
    state
  );

  // Check clubbing transparency if item and plant are known
  const activeLine = updatedState.lines[updatedState.active_line_index];
  if (activeLine && activeLine.item_code && activeLine.plant && !updatedState.clubbing_notice) {
    const similar = await prisma.pRLine.findFirst({
      where: {
        resolved_item_code: activeLine.item_code,
        plant: activeLine.plant,
        status: { in: ['open', 'grouped'] },
      },
      orderBy: { created_at: 'desc' },
    });

    if (similar) {
      updatedState.clubbing_notice = `Anti-Splitting Notice: A similar request (${similar.pr_no}, ${similar.quantity} ${similar.uom}, needed by ${similar.need_by_date}) exists for this item at plant ${similar.plant}. Procurement policy will treat them as one combined requirement to leverage volume pricing.`;
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
