import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parsePRBatchCSV, processBatch } from '../services/batch.service.js';
import { generateDecisionsCSV } from '../services/export.service.js';
import { prisma } from '../prisma.js';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
export const batchRouter = Router();

// POST /api/process-batch
batchRouter.post(
  '/process-batch',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      let csvContent = '';
      let fileName = 'raw_input.csv';

      if (req.file) {
        csvContent = req.file.buffer.toString('utf-8');
        fileName = req.file.originalname;
      } else if (typeof req.body === 'string' && req.body.trim().length > 0) {
        csvContent = req.body;
      } else if (req.body && req.body.csv) {
        csvContent = req.body.csv;
      } else {
        return res.status(400).json({ error: 'No CSV file or body provided' });
      }

      const inputLines = parsePRBatchCSV(csvContent);
      const persist = req.query.persist === 'true';
      const format = req.query.format === 'csv' ? 'csv' : 'json';
      const policyVersion = req.query.policy_version as string | undefined;
      const asOfPolicy = req.query.as_of_policy as string | undefined;

      const result = await processBatch(inputLines, {
        fileName,
        persist,
        policy_version: policyVersion,
        as_of_policy: asOfPolicy,
      });

      if (format === 'csv') {
        const csvStr = generateDecisionsCSV(result.outputRows);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="decisions.csv"');
        return res.send(csvStr);
      }

      return res.json({
        summary: result.summary,
        outputRows: result.outputRows,
        batchId: result.batchId,
      });
    } catch (err: any) {
      console.error('Error processing batch:', err);
      return res.status(500).json({ error: err.message || 'Failed to process batch' });
    }
  }
);

// GET /api/batches
batchRouter.get('/batches', async (_req: Request, res: Response) => {
  const batches = await prisma.pRBatch.findMany({
    orderBy: { created_at: 'desc' },
  });
  return res.json(batches);
});

// GET /api/batches/:id
batchRouter.get('/batches/:id', async (req: Request, res: Response) => {
  const batch = await prisma.pRBatch.findUnique({
    where: { id: req.params.id },
  });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const lines = await prisma.pRLine.findMany({
    where: { batch_id: req.params.id },
  });

  return res.json({ batch, lines });
});

// POST /api/batches/:id/reprocess
batchRouter.post('/batches/:id/reprocess', async (req: Request, res: Response) => {
  const batch = await prisma.pRBatch.findUnique({
    where: { id: req.params.id },
  });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const lines = await prisma.pRLine.findMany({
    where: { batch_id: req.params.id },
  });

  const rawLines = lines.map((l) => ({
    pr_no: l.pr_no,
    pr_line: l.pr_line,
    created_at: l.created_at.toISOString(),
    requester: l.requester,
    department: l.department,
    plant: l.plant,
    item_code: l.resolved_item_code,
    description: l.description,
    quantity: l.quantity,
    uom: l.uom,
    estimated_unit_price: l.estimated_unit_price,
    need_by_date: l.need_by_date,
    urgency: l.urgency,
  }));

  const policyVersion = req.body.policy_version || (req.query.policy_version as string | undefined);
  const result = await processBatch(rawLines, {
    fileName: batch.file_name,
    persist: true,
    policy_version: policyVersion,
  });

  return res.json({
    message: 'Batch reprocessed successfully',
    summary: result.summary,
    outputRows: result.outputRows,
  });
});

// GET /api/batches/:id/export.csv
batchRouter.get('/batches/:id/export.csv', async (req: Request, res: Response) => {
  const lines = await prisma.pRLine.findMany({
    where: { batch_id: req.params.id },
  });

  const rawLines = lines.map((l) => ({
    pr_no: l.pr_no,
    pr_line: l.pr_line,
    created_at: l.created_at.toISOString(),
    requester: l.requester,
    department: l.department,
    plant: l.plant,
    item_code: l.resolved_item_code,
    description: l.description,
    quantity: l.quantity,
    uom: l.uom,
    estimated_unit_price: l.estimated_unit_price,
    need_by_date: l.need_by_date,
    urgency: l.urgency,
  }));

  const result = await processBatch(rawLines, { persist: false });
  const csvStr = generateDecisionsCSV(result.outputRows);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="batch_${req.params.id}_decisions.csv"`);
  return res.send(csvStr);
});
