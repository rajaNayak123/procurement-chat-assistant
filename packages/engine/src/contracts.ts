import { Contract, ContractLine, SupplierMaster } from './types.js';
import { getCalendarDaysDiff } from './utils/dates.js';

export interface EvaluatedContract {
  contract: Contract;
  line: ContractLine;
  supplier: SupplierMaster;
  rate: number;
  ceiling_left: number;
  applies: boolean;
  is_usable: boolean;
  reason?: string;
}

export class ContractTracker {
  private consumedMap: Map<string, number>;
  private supplierMap: Map<string, SupplierMaster>;
  private linesByContractAndItem: Map<string, ContractLine>;

  constructor(
    private contracts: Contract[],
    contractLines: ContractLine[],
    suppliers: SupplierMaster[],
    initialLedger?: Map<string, number>
  ) {
    this.consumedMap = new Map();
    this.supplierMap = new Map(suppliers.map((s) => [s.supplier_id, s]));
    this.linesByContractAndItem = new Map();

    for (const line of contractLines) {
      const key = `${line.contract_id}:${line.item_code.toUpperCase()}`;
      this.linesByContractAndItem.set(key, line);
    }

    // Initialize consumed ceiling
    for (const c of contracts) {
      // Baseline consumed value: from register + ledger
      const ledgerConsumed = initialLedger?.get(c.contract_id) ?? 0;
      const initialConsumed = (c.consumed_value || 0) + ledgerConsumed;
      this.consumedMap.set(c.contract_id, initialConsumed);
    }
  }

  public getConsumed(contractId: string): number {
    return this.consumedMap.get(contractId) ?? 0;
  }

  public recordConsumption(contractId: string, amount: number): void {
    const current = this.getConsumed(contractId);
    this.consumedMap.set(contractId, current + amount);
  }

  /**
   * Find all contracts covering item on requirementDate
   */
  public getApplicableContracts(
    itemCode: string,
    requirementDate: string, // YYYY-MM-DD
    quantity: number
  ): EvaluatedContract[] {
    const code = itemCode.toUpperCase();
    const results: EvaluatedContract[] = [];

    for (const contract of this.contracts) {
      const lineKey = `${contract.contract_id}:${code}`;
      const line = this.linesByContractAndItem.get(lineKey);
      if (!line) continue;

      const supplier = this.supplierMap.get(contract.supplier_id);
      if (!supplier) continue;

      // 1. Supplier must be Active (Rule 4.1 & 5.7: Blocked/Inactive never applies)
      if (supplier.status !== 'Active') {
        continue;
      }

      // 2. Date within start..end inclusive
      const startDiff = getCalendarDaysDiff(requirementDate, contract.start_date);
      const endDiff = getCalendarDaysDiff(contract.end_date, requirementDate);
      if (startDiff < 0 || endDiff < 0) {
        continue;
      }

      const consumed = this.getConsumed(contract.contract_id);
      const ceilingLeft = Math.max(0, contract.value_cap - consumed);
      const neededValue = quantity * line.rate;
      const isUsable = neededValue <= ceilingLeft;

      results.push({
        contract,
        line,
        supplier,
        rate: line.rate,
        ceiling_left: ceilingLeft,
        applies: true,
        is_usable: isUsable,
      });
    }

    return results;
  }

  /**
   * Select best usable contract: lowest rate with room, tie: earlier end_date, then contract_id
   */
  public selectBestContract(applicable: EvaluatedContract[]): EvaluatedContract | null {
    const usable = applicable.filter((c) => c.is_usable);
    if (usable.length === 0) return null;

    usable.sort((a, b) => {
      // 1. Lowest rate
      if (Math.abs(a.rate - b.rate) > 0.0001) {
        return a.rate - b.rate;
      }
      // 2. Earlier end_date
      const endDiff = getCalendarDaysDiff(a.contract.end_date, b.contract.end_date);
      if (endDiff !== 0) {
        return endDiff;
      }
      // 3. Lower contract_id
      return a.contract.contract_id.localeCompare(b.contract.contract_id);
    });

    return usable[0];
  }

  /**
   * For valuation 3.1(a): If every applicable contract is out of ceiling, pick lowest applicable rate
   */
  public getLowestApplicableRate(applicable: EvaluatedContract[]): EvaluatedContract | null {
    if (applicable.length === 0) return null;
    const sorted = [...applicable].sort((a, b) => {
      if (Math.abs(a.rate - b.rate) > 0.0001) return a.rate - b.rate;
      return a.contract.contract_id.localeCompare(b.contract.contract_id);
    });
    return sorted[0];
  }
}
