import { stringify } from 'csv-stringify/sync';
import { DecisionOutputRow, PreferredSupplierRank } from '@cantill/engine';

export function generateDecisionsCSV(rows: DecisionOutputRow[]): string {
  const columns = [
    'pr_no',
    'pr_line',
    'resolved_item_code',
    'group_id',
    'po_id',
    'decision',
    'route',
    'supplier_id',
    'unit_price',
    'group_value_inr',
    'suggested_supplier_ids',
    'policy_version',
    'reason',
  ];

  const data = rows.map((r) => [
    r.pr_no,
    r.pr_line,
    r.resolved_item_code,
    r.group_id,
    r.po_id,
    r.decision,
    r.route,
    r.supplier_id,
    r.unit_price,
    r.group_value_inr,
    r.suggested_supplier_ids,
    r.policy_version,
    r.reason,
  ]);

  return stringify(data, {
    header: true,
    columns,
    quoted_match: /[,\n\r"]/,
  });
}

export function generatePreferredSuppliersCSV(
  allRankings: Array<{ item_code: string; ranks: PreferredSupplierRank[] }>
): string {
  const columns = ['item_code', 'rank', 'supplier_id', 'reference_price'];
  const rows: any[] = [];

  for (const item of allRankings) {
    const top3 = item.ranks.slice(0, 3);
    for (const rank of top3) {
      rows.push([
        item.item_code,
        rank.rank,
        rank.supplier_id,
        rank.reference_price !== null ? rank.reference_price.toFixed(2) : '',
      ]);
    }
  }

  return stringify(rows, {
    header: true,
    columns,
  });
}
