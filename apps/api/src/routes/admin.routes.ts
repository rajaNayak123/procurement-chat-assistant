import { Router, Request, Response } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import pdfParse from 'pdf-parse';
import { prisma } from '../prisma.js';
import { extractContractFromText } from '../services/contract.service.js';
import { logAuditEvent } from '../services/audit.service.js';
import { DEFAULT_POLICY_V5 } from '@cantill/policy';

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB
export const adminRouter = Router();

// POST /api/admin/import-master-data
// Accepts files for: plants, item_master, supplier_master, po_history, contract_register, contract_lines, and optional pdfs
adminRouter.post(
  '/admin/import-master-data',
  upload.any(),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const importedCounts: Record<string, number> = {};

      for (const file of files) {
        const name = file.originalname.toLowerCase();
        const content = file.buffer.toString('utf-8');

        // 1. Plants
        if (name.includes('plant')) {
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            await prisma.plant.upsert({
              where: { plant: r.plant.trim().toUpperCase() },
              create: { plant: r.plant.trim().toUpperCase(), name: r.name.trim() },
              update: { name: r.name.trim() },
            });
          }
          importedCounts['plants'] = records.length;
        }

        // 2. Item Master
        else if (name.includes('item_master') || name.includes('items')) {
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            await prisma.item.upsert({
              where: { item_code: r.item_code.trim().toUpperCase() },
              create: {
                item_code: r.item_code.trim().toUpperCase(),
                description: r.description.trim(),
                uom: r.uom.trim(),
                category: r.category.trim(),
                item_type: r.item_type.trim(),
                standard_price: parseFloat(r.standard_price) || 0,
              },
              update: {
                description: r.description.trim(),
                uom: r.uom.trim(),
                category: r.category.trim(),
                item_type: r.item_type.trim(),
                standard_price: parseFloat(r.standard_price) || 0,
              },
            });
          }
          importedCounts['items'] = records.length;
        }

        // 3. Supplier Master
        else if (name.includes('supplier_master') || name.includes('suppliers')) {
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            await prisma.supplier.upsert({
              where: { supplier_id: r.supplier_id.trim().toUpperCase() },
              create: {
                supplier_id: r.supplier_id.trim().toUpperCase(),
                name: r.name.trim(),
                city: r.city.trim(),
                categories: r.categories.trim(),
                status: r.status.trim(),
                on_time_pct: parseFloat(r.on_time_pct) || 0,
                quality_rating: parseFloat(r.quality_rating) || 0,
              },
              update: {
                name: r.name.trim(),
                city: r.city.trim(),
                categories: r.categories.trim(),
                status: r.status.trim(),
                on_time_pct: parseFloat(r.on_time_pct) || 0,
                quality_rating: parseFloat(r.quality_rating) || 0,
              },
            });
          }
          importedCounts['suppliers'] = records.length;
        }

        // 4. PO History
        else if (name.includes('po_history') || name.includes('history')) {
          const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
          for (const r of records) {
            const isDeliveredOnTime =
              String(r.delivered_on_time).trim().toLowerCase() === 'true';
            await prisma.pOHistory.create({
              data: {
                po_number: r.po_number.trim(),
                po_date: r.po_date.trim(),
                supplier_id: r.supplier_id.trim().toUpperCase(),
                item_code: r.item_code.trim().toUpperCase(),
                quantity: parseFloat(r.quantity) || 0,
                uom: r.uom.trim(),
                unit_price: parseFloat(r.unit_price) || 0,
                plant: r.plant.trim().toUpperCase(),
                delivered_on_time: isDeliveredOnTime,
              },
            });
          }
          importedCounts['po_history'] = records.length;
        }

        // 5. Contract Register
        else if (name.includes('contract_register')) {
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
          }
          importedCounts['contract_register'] = records.length;
        }

        // 6. Contract Lines
        else if (name.includes('contract_lines')) {
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
          }
          importedCounts['contract_lines'] = records.length;
        }

        // 7. PDF Contract files
        else if (name.endsWith('.pdf')) {
          try {
            const pdfData = await pdfParse(file.buffer);
            const extracted = await extractContractFromText(pdfData.text);
            if (extracted.contract_id) {
              await prisma.contract.upsert({
                where: { contract_id: extracted.contract_id },
                create: {
                  contract_id: extracted.contract_id,
                  supplier_id: extracted.supplier_id,
                  supplier_name: extracted.supplier_name,
                  start_date: extracted.start_date,
                  end_date: extracted.end_date,
                  value_cap: extracted.value_cap,
                  consumed_value: 0,
                  source: 'pdf',
                },
                update: {
                  supplier_id: extracted.supplier_id,
                  supplier_name: extracted.supplier_name,
                  start_date: extracted.start_date,
                  end_date: extracted.end_date,
                  value_cap: extracted.value_cap,
                },
              });

              for (const line of extracted.lines) {
                await prisma.contractLine.upsert({
                  where: {
                    contract_id_item_code: {
                      contract_id: extracted.contract_id,
                      item_code: line.item_code,
                    },
                  },
                  create: {
                    contract_id: extracted.contract_id,
                    item_code: line.item_code,
                    description: line.description,
                    uom: line.uom,
                    rate: line.rate,
                  },
                  update: {
                    rate: line.rate,
                  },
                });
              }
              importedCounts['pdf_contracts'] = (importedCounts['pdf_contracts'] || 0) + 1;
            }
          } catch (e) {
            console.warn(`Failed to parse PDF ${name}:`, e);
          }
        }
      }

      // Ensure Policy v5.0 is seeded
      await prisma.policyVersion.upsert({
        where: { version: '5.0' },
        create: {
          policy_id: DEFAULT_POLICY_V5.policy_id,
          version: '5.0',
          effective_from: DEFAULT_POLICY_V5.effective_from,
          status: 'active',
          policy_json: JSON.stringify(DEFAULT_POLICY_V5, null, 2),
          approved_by: 'System Seed',
        },
        update: {},
      });

      await logAuditEvent('System', 'master_data', 'import', 'Admin Demo', 'Procurement Head', importedCounts);

      return res.json({
        message: 'Master data imported successfully',
        importedCounts,
      });
    } catch (err: any) {
      console.error('Error importing master data:', err);
      return res.status(500).json({ error: err.message || 'Failed to import master data' });
    }
  }
);
