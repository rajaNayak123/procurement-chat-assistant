import { Router, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { getOrCreateChatSession, processUserChatMessage } from '../services/chat.service.js';

export const chatRouter = Router();

// POST /api/chat/sessions
chatRouter.post('/chat/sessions', async (req: Request, res: Response) => {
  const { user_name = 'Requester Demo' } = req.body;
  const session = await getOrCreateChatSession(undefined, user_name);

  // Send initial welcome message
  const welcomeMessage = `Hello! I am your AI Requisition Assistant at Corvo Engineering. What materials or services do you need to procure today?`;

  await prisma.chatMessage.create({
    data: {
      session_id: session.id,
      sender: 'assistant',
      text: welcomeMessage,
      metadata: JSON.stringify({
        quickReplies: [
          'Need 200 nitrile gloves for Chakan by next Friday',
          'brg 6205 2rs 50 pcs PUN1 emergency by tomorrow',
          'Need 2 laptops and 5 monitors for Bhosari by 30 Nov',
        ],
      }),
    },
  });

  return res.json({ session, welcomeMessage });
});

// GET /api/chat/sessions/:id
chatRouter.get('/chat/sessions/:id', async (req: Request, res: Response) => {
  const session = await prisma.chatSession.findUnique({
    where: { id: req.params.id },
  });

  if (!session) {
    return res.status(404).json({ error: 'Chat session not found' });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { session_id: req.params.id },
    orderBy: { created_at: 'asc' },
  });

  return res.json({ session, messages });
});

// POST /api/chat/sessions/:id/messages
chatRouter.post('/chat/sessions/:id/messages', async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Message text required' });
  }

  try {
    const result = await processUserChatMessage(req.params.id, text);
    return res.json(result);
  } catch (err: any) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message || 'Chat error' });
  }
});

// GET /api/pr-lines
chatRouter.get('/pr-lines', async (req: Request, res: Response) => {
  const { requester, status } = req.query;
  const where: any = {};
  if (requester) where.requester = String(requester);
  if (status) where.status = String(status);

  const lines = await prisma.pRLine.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  return res.json(lines);
});
