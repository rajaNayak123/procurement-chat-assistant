import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import pdfParse from 'pdf-parse';
import { prisma } from '../prisma.js';
import { extractContractFromText } from '../services/contract.service.js';
import { DEFAULT_POLICY_V5 } from '@cantill/policy';

async function seed() {
  console.log('==> Starting database seed...');

  // 1. Seed Demo Users
  const users = [
    { name: 'Aditi Sharma', email: 'aditi.sharma@corvo.internal', role: 'Requester' },
    { name: 'Rajesh Nair', email: 'rajesh.nair@corvo.internal', role: 'Buyer' },
    { name: 'Vikram Mehta', email: 'vikram.mehta@corvo.internal', role: 'Procurement Head' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: u,
      update: { role: u.role },
    });
  }
  console.log('✓ Seeded demo users');

  // 2. Seed Default Policy v5.0
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
  console.log('✓ Seeded Default Policy v5.0');

  // 3. Check for `./data` or `../data` folder
  const possibleDataDirs = [
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), '../../data'),
    path.resolve(process.cwd(), '../data'),
  ];

  let dataDir = possibleDataDirs.find((d) => fs.existsSync(d));

  if (!dataDir) {
    console.log('Notice: No ./data folder found at startup. Seeding with synthetic baseline data...');
    // Seed synthetic baseline so app is immediately testable out of the box
    await seedSyntheticBaseline();
    return;
  }

  console.log(`==> Found data folder at: ${dataDir}. Importing master files...`);

  // Helper to find file in data dir or subdirs
  function findFile(baseName: string): string | null {
    const direct = path.join(dataDir!, baseName);
    if (fs.existsSync(direct)) return direct;

    const subdirs = ['master_data', 'contracts', 'pr_batches'];
    for (const sub of subdirs) {
      const p = path.join(dataDir!, sub, baseName);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // Import Plants
  const plantsFile = findFile('plants.csv');
  if (plantsFile) {
    const records = parse(fs.readFileSync(plantsFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
    for (const r of records) {
      await prisma.plant.upsert({
        where: { plant: r.plant.trim().toUpperCase() },
        create: { plant: r.plant.trim().toUpperCase(), name: r.name.trim() },
        update: { name: r.name.trim() },
      });
    }
    console.log(`✓ Imported ${records.length} plants`);
  }

  // Import Item Master
  const itemsFile = findFile('item_master.csv');
  if (itemsFile) {
    const records = parse(fs.readFileSync(itemsFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
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
    console.log(`✓ Imported ${records.length} items`);
  }

  // Import Supplier Master
  const suppliersFile = findFile('supplier_master.csv');
  if (suppliersFile) {
    const records = parse(fs.readFileSync(suppliersFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
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
    console.log(`✓ Imported ${records.length} suppliers`);
  }

  // Import PO History
  const poFile = findFile('po_history.csv');
  if (poFile) {
    const records = parse(fs.readFileSync(poFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
    for (const r of records) {
      const isDeliveredOnTime = String(r.delivered_on_time).trim().toLowerCase() === 'true';
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
    console.log(`✓ Imported ${records.length} PO history rows`);
  }

  // Import Contract Register
  const contractRegFile = findFile('contract_register.csv');
  if (contractRegFile) {
    const records = parse(fs.readFileSync(contractRegFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
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
    console.log(`✓ Imported ${records.length} contracts from register`);
  }

  // Import Contract Lines
  const contractLinesFile = findFile('contract_lines.csv');
  if (contractLinesFile) {
    const records = parse(fs.readFileSync(contractLinesFile, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
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
    console.log(`✓ Imported ${records.length} contract lines`);
  }

  // Import PDF contracts if present (e.g. RC-2026-031, RC-2026-033)
  const pdfDirs = [
    path.join(dataDir, 'contracts', 'pdf'),
    path.join(dataDir, 'contracts'),
    path.join(dataDir, 'pdf'),
  ];
  for (const dir of pdfDirs) {
    if (fs.existsSync(dir)) {
      const pdfFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
      for (const pdfName of pdfFiles) {
        try {
          const buffer = fs.readFileSync(path.join(dir, pdfName));
          const pdfData = await pdfParse(buffer);
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

            for (const l of extracted.lines) {
              await prisma.contractLine.upsert({
                where: {
                  contract_id_item_code: {
                    contract_id: extracted.contract_id,
                    item_code: l.item_code,
                  },
                },
                create: {
                  contract_id: extracted.contract_id,
                  item_code: l.item_code,
                  description: l.description,
                  uom: l.uom,
                  rate: l.rate,
                },
                update: {
                  rate: l.rate,
                },
              });
            }
            console.log(`✓ Processed PDF contract ${extracted.contract_id} from ${pdfName}`);
          }
        } catch (e) {
          console.warn(`Could not parse ${pdfName}:`, e);
        }
      }
    }
  }

  console.log('==> Data import complete!');
}

async function seedSyntheticBaseline() {
  const plants = [
    { plant: 'PUN1', name: 'Pune - Bhosari plant' },
    { plant: 'CHK1', name: 'Chakan plant' },
  ];
  for (const p of plants) {
    await prisma.plant.upsert({
      where: { plant: p.plant },
      create: p,
      update: {},
    });
  }

  const items = [
    {
      item_code: 'ITM-1001',
      description: 'Ball bearing 6205-2RS',
      uom: 'NOS',
      category: 'Bearings',
      item_type: 'Material',
      standard_price: 350.0,
    },
    {
      item_code: 'ITM-1004',
      description: 'Nitrile coated work safety gloves',
      uom: 'PAIR',
      category: 'Safety',
      item_type: 'Material',
      standard_price: 120.0,
    },
    {
      item_code: 'ITM-1016',
      description: 'VCI Anti Rust Poly Bag 1000x1200mm',
      uom: 'NOS',
      category: 'Packaging',
      item_type: 'Material',
      standard_price: 22.5,
    },
    {
      item_code: 'ITM-1036',
      description: 'Pneumatic Cylinder 50x100mm Stroke',
      uom: 'NOS',
      category: 'Pneumatics',
      item_type: 'Material',
      standard_price: 3800.0,
    },
    {
      item_code: 'ITM-1048',
      description: 'High Tensile Hex Bolt M16x60 GR 8.8',
      uom: 'NOS',
      category: 'Fasteners',
      item_type: 'Material',
      standard_price: 7.5,
    },
    {
      item_code: 'ITM-1069',
      description: 'EOT Crane 5 Ton Single Girder',
      uom: 'NOS',
      category: 'Capital Equipment',
      item_type: 'Capex',
      standard_price: 1500000.0,
    },
  ];
  for (const it of items) {
    await prisma.item.upsert({
      where: { item_code: it.item_code },
      create: it,
      update: {},
    });
  }

  const suppliers = [
    {
      supplier_id: 'S001',
      name: 'Apex Fasteners Pvt Ltd',
      city: 'Pune',
      categories: 'Fasteners;Packaging',
      status: 'Active',
      on_time_pct: 92.5,
      quality_rating: 4.6,
    },
    {
      supplier_id: 'S004',
      name: 'Metalink Alloys',
      city: 'Mumbai',
      categories: 'Fasteners;Metals',
      status: 'Blocked',
      on_time_pct: 45.0,
      quality_rating: 2.2,
    },
    {
      supplier_id: 'S021',
      name: 'Pneumatic Point Solutions',
      city: 'Pune',
      categories: 'Pneumatics;Hydraulics',
      status: 'Active',
      on_time_pct: 94.0,
      quality_rating: 4.8,
    },
    {
      supplier_id: 'S029',
      name: 'Standard Precision Fasteners',
      city: 'Bhosari',
      categories: 'Fasteners',
      status: 'Active',
      on_time_pct: 96.0,
      quality_rating: 4.9,
    },
    {
      supplier_id: 'S030',
      name: 'Western Fasteners',
      city: 'Chakan',
      categories: 'Fasteners',
      status: 'Active',
      on_time_pct: 88.0,
      quality_rating: 4.2,
    },
    {
      supplier_id: 'S045',
      name: 'Indo Crane & Material Handling',
      city: 'Pune',
      categories: 'Capital Equipment',
      status: 'Active',
      on_time_pct: 91.0,
      quality_rating: 4.7,
    },
  ];
  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { supplier_id: s.supplier_id },
      create: s,
      update: {},
    });
  }

  await prisma.contract.upsert({
    where: { contract_id: 'RC-2026-013' },
    create: {
      contract_id: 'RC-2026-013',
      supplier_id: 'S029',
      supplier_name: 'Standard Precision Fasteners',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      value_cap: 500000,
      consumed_value: 120000,
      source: 'register',
    },
    update: {},
  });

  await prisma.contractLine.upsert({
    where: {
      contract_id_item_code: {
        contract_id: 'RC-2026-013',
        item_code: 'ITM-1048',
      },
    },
    create: {
      contract_id: 'RC-2026-013',
      item_code: 'ITM-1048',
      description: 'High Tensile Hex Bolt M16x60 GR 8.8',
      uom: 'NOS',
      rate: 7.06,
    },
    update: {},
  });

  console.log('✓ Seeded synthetic baseline data');
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
