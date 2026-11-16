import {
  PlantMaster,
  ItemMaster,
  SupplierMaster,
  POHistoryRow,
  Contract,
  ContractLine,
} from '../../src/types.js';

export const SYNTHETIC_PLANTS: PlantMaster[] = [
  { plant: 'SYN-P1', name: 'Synthetic Alpha Plant' },
  { plant: 'SYN-P2', name: 'Synthetic Beta Plant' },
];

export const SYNTHETIC_ITEMS: ItemMaster[] = [
  {
    item_code: 'SYN-ITM-01',
    description: 'Deep Groove Ball Bearing 6308-ZZ',
    uom: 'NOS',
    category: 'Mechanical Spares',
    item_type: 'Material',
    standard_price: 1500,
  },
  {
    item_code: 'SYN-ITM-02',
    description: 'High Pressure Hydraulic Hose 1/2 inch',
    uom: 'MTR',
    category: 'Hydraulics',
    item_type: 'Material',
    standard_price: 850,
  },
  {
    item_code: 'SYN-ITM-03',
    description: 'Overhead Bridge Crane 10 Ton',
    uom: 'SET',
    category: 'Capital Equipment',
    item_type: 'Capex',
    standard_price: 5000000,
  },
  {
    item_code: 'SYN-ITM-04',
    description: 'Nitrile Coated Work Safety Gloves',
    uom: 'PAIR',
    category: 'Safety',
    item_type: 'Material',
    standard_price: 120,
  },
];

export const SYNTHETIC_SUPPLIERS: SupplierMaster[] = [
  {
    supplier_id: 'SYN-SUP-101',
    name: 'Alpha Engineering Supplies',
    city: 'Pune',
    categories: ['Mechanical Spares', 'Hydraulics'],
    status: 'Active',
    on_time_pct: 95,
    quality_rating: 4.8,
  },
  {
    supplier_id: 'SYN-SUP-102',
    name: 'Beta Industrial Spares',
    city: 'Mumbai',
    categories: ['Mechanical Spares', 'Safety'],
    status: 'Active',
    on_time_pct: 88,
    quality_rating: 4.2,
  },
  {
    supplier_id: 'SYN-SUP-103',
    name: 'Gamma Heavy Machinery',
    city: 'Ahmedabad',
    categories: ['Capital Equipment'],
    status: 'Active',
    on_time_pct: 90,
    quality_rating: 4.5,
  },
  {
    supplier_id: 'SYN-SUP-BLOCKED',
    name: 'Blocked Defective Vendor',
    city: 'Delhi',
    categories: ['Mechanical Spares', 'Hydraulics'],
    status: 'Blocked',
    on_time_pct: 40,
    quality_rating: 2.1,
  },
  {
    supplier_id: 'SYN-SUP-INACTIVE',
    name: 'Dormant Inactive Vendor',
    city: 'Bangalore',
    categories: ['Safety'],
    status: 'Inactive',
    on_time_pct: 70,
    quality_rating: 3.0,
  },
];

export const SYNTHETIC_CONTRACTS: Contract[] = [
  {
    contract_id: 'SYN-RC-01',
    supplier_id: 'SYN-SUP-101',
    supplier_name: 'Alpha Engineering Supplies',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    value_cap: 1000000,
    consumed_value: 950000, // 50,000 left
    source: 'register',
  },
  {
    contract_id: 'SYN-RC-02',
    supplier_id: 'SYN-SUP-102',
    supplier_name: 'Beta Industrial Spares',
    start_date: '2026-06-01',
    end_date: '2027-05-31',
    value_cap: 500000,
    consumed_value: 0,
    source: 'pdf',
  },
];

export const SYNTHETIC_CONTRACT_LINES: ContractLine[] = [
  {
    contract_id: 'SYN-RC-01',
    item_code: 'SYN-ITM-01',
    description: 'Deep Groove Ball Bearing 6308-ZZ',
    uom: 'NOS',
    rate: 1350, // cheaper than standard
  },
  {
    contract_id: 'SYN-RC-02',
    item_code: 'SYN-ITM-01',
    description: 'Deep Groove Ball Bearing 6308-ZZ',
    uom: 'NOS',
    rate: 1400,
  },
  {
    contract_id: 'SYN-RC-02',
    item_code: 'SYN-ITM-04',
    description: 'Nitrile Coated Work Safety Gloves',
    uom: 'PAIR',
    rate: 100,
  },
];

export const SYNTHETIC_PO_HISTORY: POHistoryRow[] = [
  {
    po_number: 'SYN-PO-9001',
    po_date: '2026-10-15',
    supplier_id: 'SYN-SUP-101',
    item_code: 'SYN-ITM-01',
    quantity: 20,
    uom: 'NOS',
    unit_price: 1360,
    plant: 'SYN-P1',
    delivered_on_time: true,
  },
  {
    po_number: 'SYN-PO-9002',
    po_date: '2026-09-01',
    supplier_id: 'SYN-SUP-102',
    item_code: 'SYN-ITM-01',
    quantity: 10,
    uom: 'NOS',
    unit_price: 1380,
    plant: 'SYN-P1',
    delivered_on_time: true,
  },
  {
    po_number: 'SYN-PO-9003',
    po_date: '2026-08-20',
    supplier_id: 'SYN-SUP-101',
    item_code: 'SYN-ITM-02',
    quantity: 50,
    uom: 'MTR',
    unit_price: 800,
    plant: 'SYN-P2',
    delivered_on_time: true,
  },
];
