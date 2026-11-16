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

// POST /api/contracts/import (CSV import for register or lines)
contractsRouter.post(
  '/contracts/import',
  upload.any(),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No CSV files uploaded' });
      }

      let importedRegister = 0;
      let importedLines = 0;

      for (const file of files) {
        const name = file.originalname.toLowerCase();
        const content = file.buffer.toString('utf-8');

        if (name.includes('register')) {
          const { parse } = await import('csv-parse/sync');
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            await prisma.contract.upsert({
              where: { contract_id: r.contract_id.trim() },
              create: {
                contract_id: r.contract_id.trim(),
                supplier_id: r.supplier_id.trim().toUpperCase(),
                supplier_name: r.supplier_name.trim(),
                start_date: r.start_date.trim(),
                end_date: r.end_date.trim(),
                value_cap: parseFloat(r.value_cap) || 0,
                consumed_value: parseFloat(r.consumed_value) || 0,
                source: 'register',
              },
              update: {
                supplier_id: r.supplier_id.trim().toUpperCase(),
                supplier_name: r.supplier_name.trim(),
                start_date: r.start_date.trim(),
                end_date: r.end_date.trim(),
                value_cap: parseFloat(r.value_cap) || 0,
                consumed_value: parseFloat(r.consumed_value) || 0,
              },
            });
            importedRegister++;
          }
        } else if (name.includes('lines') || name.includes('line')) {
          const { parse } = await import('csv-parse/sync');
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            await prisma.contractLine.upsert({
              where: {
                contract_id_item_code: {
                  contract_id: r.contract_id.trim(),
                  item_code: r.item_code.trim().toUpperCase(),
                },
              },
              create: {
                contract_id: r.contract_id.trim(),
                item_code: r.item_code.trim().toUpperCase(),
                description: r.description.trim(),
                uom: r.uom.trim(),
                rate: parseFloat(r.rate) || 0,
              },
              update: {
                description: r.description.trim(),
                uom: r.uom.trim(),
                rate: parseFloat(r.rate) || 0,
              },
            });
            importedLines++;
          }
        }
      }

      await logAuditEvent('Contract', 'bulk_import', 'import', 'Buyer Demo', 'Buyer', {
        importedRegister,
        importedLines,
      });

      return res.json({
        message: 'Contracts imported successfully',
        importedRegister,
        importedLines,
      });
    } catch (err: any) {
      console.error('Error importing contracts:', err);
      return res.status(500).json({ error: err.message || 'Failed to import contracts' });
    }
  }
);
