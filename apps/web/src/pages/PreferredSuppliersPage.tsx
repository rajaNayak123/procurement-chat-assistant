import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import {
  Users,
  Download,
  Calendar,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';

export const PreferredSuppliersPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [selectedItemCode, setSelectedItemCode] = useState<string>('ITM-1001');
  const [asOfDate, setAsOfDate] = useState<string>('2026-11-15');
  const [rankingData, setRankingData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const itemList = await api.getItems();
        setItems(itemList);
        if (itemList.length > 0) {
          setSelectedItemCode(itemList[0].item_code);
        }
      } catch (err) {
        console.error('Failed to load items:', err);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!selectedItemCode) return;
    async function loadRanking() {
      setLoading(true);
      try {
        const res = await api.getPreferredSuppliers(selectedItemCode, asOfDate);
        setRankingData(res);
      } catch (err) {
        console.error('Failed to fetch ranking:', err);
      } finally {
        setLoading(false);
      }
    }
    loadRanking();
  }, [selectedItemCode, asOfDate]);

  const handleExportCsv = () => {
    window.open(`/api/preferred-suppliers/export?as_of=${asOfDate}`, '_blank');
  };

  const selectedItem = items.find((i) => i.item_code === selectedItemCode);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Preferred Supplier Ranking & Explainability</h1>
          <p className="text-xs text-slate-500 mt-1">
            Automated ranking computed from 548-day PO history, contracts, on-time delivery, and quality.
          </p>
        </div>

        {/* Primary Action Button */}
        <button
          onClick={handleExportCsv}
          className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
        >
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Selectors Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4 text-xs">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Select Catalog Item</label>
          <select
            value={selectedItemCode}
            onChange={(e) => setSelectedItemCode(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            {items.map((it) => (
              <option key={it.item_code} value={it.item_code}>
                {it.item_code} — {it.description} ({it.category})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">As-Of Date</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
          </input>
        </div>
      </div>

      {selectedItem && (
        <div className="bg-sky-50/60 border border-sky-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
          <div>
            <span className="font-mono font-bold text-sky-800 text-sm mr-2">{selectedItem.item_code}</span>
            <span className="font-semibold text-slate-900">{selectedItem.description}</span>
            <span className="ml-2 text-slate-500">({selectedItem.category} • {selectedItem.item_type})</span>
          </div>
          <div className="font-mono text-slate-700">
            Standard Price: <b>Rs {selectedItem.standard_price.toFixed(2)}</b> / {selectedItem.uom}
          </div>
        </div>
      )}

      {/* Preferred Table */}
      {rankingData && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Qualified Active Preferred Suppliers ({rankingData.preferred?.length || 0})
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-100 font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">POs (548d)</th>
                    <th className="px-4 py-3">Last PO / Age</th>
                    <th className="px-4 py-3">Contract Held</th>
                    <th className="px-4 py-3">On-Time %</th>
                    <th className="px-4 py-3">Quality</th>
                    <th className="px-4 py-3">Total Score</th>
                    <th className="px-4 py-3">Ref Price</th>
                    <th className="px-4 py-3">Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rankingData.preferred.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500 italic">
                        No active suppliers with PO history or contracts for this item in window.
                      </td>
                    </tr>
                  ) : (
                    rankingData.preferred.map((sup: any) => (
                      <tr key={sup.supplier_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          <span
                            className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs ${
                              sup.rank === 1
                                ? 'bg-amber-100 text-amber-800 font-bold'
                                : sup.rank === 2
                                ? 'bg-slate-200 text-slate-700 font-bold'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {sup.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{sup.supplier_name}</div>
                          <div className="text-[11px] font-mono text-slate-500">{sup.supplier_id}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold">{sup.pos_in_window}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {sup.last_po_date ? `${sup.last_po_date} (${sup.last_po_age_days}d)` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {sup.held_contract ? (
                            <span className="font-mono text-emerald-700 font-semibold">{sup.contract_id || 'Yes'}</span>
                          ) : (
                            <span className="text-slate-400">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono">{sup.on_time_pct}%</td>
                        <td className="px-4 py-3 font-mono">{sup.quality_rating} / 5.0</td>
                        <td className="px-4 py-3 font-mono font-bold text-sky-700 text-sm">
                          {sup.total_score.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {sup.reference_price !== null ? (
                            <div>
                              <span>Rs {sup.reference_price.toFixed(2)}</span>
                              <span className="block text-[10px] text-slate-400 font-normal">
                                from {sup.reference_price_source === 'po' ? 'PO ' + sup.reference_price_ref : 'contract ' + sup.reference_price_ref}
                              </span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[280px] leading-snug">
                          {sup.explanation}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Excluded Suppliers Table */}
          {rankingData.excluded && rankingData.excluded.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-3 border-b border-slate-200 bg-rose-50/50 flex items-center space-x-2 text-rose-800 text-xs font-bold uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Excluded Suppliers (Blocked or Inactive)</span>
              </div>
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs opacity-75">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5">Supplier ID</th>
                    <th className="px-4 py-2.5">Supplier Name</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Exclusion Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-slate-50/25">
                  {rankingData.excluded.map((e: any, idx: number) => (
                    <tr key={idx} className="line-through text-slate-400">
                      <td className="px-4 py-2 font-mono font-semibold">{e.supplier.supplier_id}</td>
                      <td className="px-4 py-2">{e.supplier.name}</td>
                      <td className="px-4 py-2 font-bold text-rose-600">{e.supplier.status}</td>
                      <td className="px-4 py-2 not-italic text-slate-600">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
