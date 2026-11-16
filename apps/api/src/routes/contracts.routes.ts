import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { prisma } from '../prisma.js';
import { extractContractFromText } from '../services/contract.service.js';
import { logAuditEvent } from '../services/audit.service.js';
import { parseDateFlexible, getCalendarDaysDiff, getAppNow } from '@cantill/engine';

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
export const contractsRouter = Router();

// GET /api/contracts
contractsRouter.get('/contracts', async (_req: Request, res: Response) => {
  const [contractsDb, linesDb, suppliersDb, consumptionDb] = await Promise.all([
    prisma.contract.findMany({ orderBy: { start_date: 'desc' } }),
    prisma.contractLine.findMany(),
    prisma.supplier.findMany(),
    prisma.contractConsumption.findMany(),
  ]);

  const supplierMap = new Map(suppliersDb.map((s) => [s.supplier_id, s]));

  // Consumption ledger
  const consumptionMap = new Map<string, number>();
  for (const c of consumptionDb) {
    const cur = consumptionMap.get(c.contract_id) || 0;
    consumptionMap.set(c.contract_id, cur + c.amount);
  }

  const now = getAppNow();

  const results = contractsDb.map((c) => {
    const supplier = supplierMap.get(c.supplier_id);
    const lines = linesDb.filter((l) => l.contract_id === c.contract_id);
    const ledgerConsumed = consumptionMap.get(c.contract_id) || 0;
    const totalConsumed = c.consumed_value + ledgerConsumed;
    const remaining = Math.max(0, c.value_cap - totalConsumed);
    const percentUsed = c.value_cap > 0 ? (totalConsumed / c.value_cap) * 100 : 0;

    // Validity status
    const startDiff = getCalendarDaysDiff(now, c.start_date);
    const endDiff = getCalendarDaysDiff(c.end_date, now);

    let validityStatus = 'Valid';
    if (supplier?.status === 'Blocked' || supplier?.status === 'Inactive') {
      validityStatus = 'Supplier blocked';
    } else if (startDiff < 0) {
      validityStatus = 'Upcoming';
    } else if (endDiff < 0) {
      validityStatus = 'Expired';
    } else if (remaining < 50000 || percentUsed >= 90) {
      validityStatus = 'Ceiling nearly used';
    }

    return {
      contract_id: c.contract_id,
      supplier_id: c.supplier_id,
      supplier_name: c.supplier_name,
      supplier_status: supplier?.status || 'Unknown',
      start_date: c.start_date,
      end_date: c.end_date,
      value_cap: c.value_cap,
      consumed_value: totalConsumed,
      remaining_ceiling: remaining,
      percent_used: parseFloat(percentUsed.toFixed(1)),
      validity_status: validityStatus,
      source: c.source,
      lines,
    };
  });

  return res.json(results);
});

// POST /api/contracts (manual addition)
contractsRouter.post('/contracts', async (req: Request, res: Response) => {
  try {
    const {
      contract_id,
      supplier_id,
      start_date,
      end_date,
      value_cap,
      lines,
      source = 'manual',
    } = req.body;

    if (!contract_id || !supplier_id || !start_date || !end_date || !value_cap) {
      return res.status(400).json({ error: 'Missing required contract fields' });
    }

    // Check supplier
    const supplier = await prisma.supplier.findUnique({
      where: { supplier_id },
    });
    if (!supplier) {
      return res.status(400).json({ error: `Supplier ${supplier_id} does not exist in master data` });
    }

    if (getCalendarDaysDiff(end_date, start_date) < 0) {
      return res.status(400).json({ error: 'End date must be on or after start date' });
    }

    // Create contract
    const contract = await prisma.contract.create({
      data: {
        contract_id,
        supplier_id,
        supplier_name: supplier.name,
        start_date,
        end_date,
        value_cap: parseFloat(value_cap),
        consumed_value: 0,
        source,
      },
    });

    // Create lines if provided
    if (lines && Array.isArray(lines)) {
      for (const line of lines) {
        if (line.item_code && line.rate) {
          await prisma.contractLine.create({
            data: {
              contract_id,
              item_code: line.item_code,
              description: line.description || '',
              uom: line.uom || 'NOS',
              rate: parseFloat(line.rate),
            },
          });
        }
      }
    }

    await logAuditEvent('Contract', contract_id, 'create_manual', 'Buyer Demo', 'Buyer', {
      contract_id,
      supplier_id,
    });

    return res.status(201).json({ message: 'Contract created successfully', contract });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to create contract' });
  }
});

// POST /api/contracts/extract-pdf
contractsRouter.post(
  '/contracts/extract-pdf',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded' });
      }

      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text;

      const extracted = await extractContractFromText(text);

      return res.json(extracted);
    } catch (err: any) {
      console.error('Error extracting contract PDF:', err);
      return res.status(500).json({ error: err.message || 'Failed to extract contract from PDF' });
    }
  }
);
