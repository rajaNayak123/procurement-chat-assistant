import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useCurrentUser } from '../context/UserContext.js';
import {
  Filter,
  CheckCircle,
  Eye,
  AlertTriangle,
  ArrowUpDown,
  Building2,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';

interface BuyerQueuePageProps {
  onSelectRequirement: (id: string) => void;
}

export const BuyerQueuePage: React.FC<BuyerQueuePageProps> = ({ onSelectRequirement }) => {
  const { user } = useCurrentUser();
  const [requirements, setRequirements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [routeFilter, setRouteFilter] = useState('');
  const [plantFilter, setPlantFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [cleanOnly, setCleanOnly] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const data = await api.getRequirements({
        route: routeFilter || undefined,
        plant: plantFilter || undefined,
        status: statusFilter || undefined,
      });
      setRequirements(data);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, [routeFilter, plantFilter, statusFilter]);

  const filteredRequirements = cleanOnly
    ? requirements.filter((r) => !r.reason?.includes('warning') && !r.reason?.includes('OVERRIDDEN'))
    : requirements;

  // Primary Action: Review next pending requirement
  const handleReviewNext = () => {
    const nextReq = filteredRequirements.find((r) => r.status === 'pending');
    if (nextReq) {
      onSelectRequirement(nextReq.id);
    }
  };

  // Secondary Bulk Action: Approve all clean ones
  const handleApproveAllClean = async () => {
    const cleanPending = filteredRequirements.filter(
      (r) => r.status === 'pending' && r.route !== 'CAPEX_SOURCING'
    );
    if (cleanPending.length === 0) return;

    if (!confirm(`Are you sure you want to approve all ${cleanPending.length} clean requirements?`)) {
      return;
    }

    setBulkApproving(true);
    try {
      for (const req of cleanPending) {
        await api.approveRequirement(req.id, {
          actor: user.name,
          role: user.role,
          comment: 'Bulk approval of clean requirements',
        });
      }
      await fetchQueue();
    } catch (err) {
      console.error('Error during bulk approve:', err);
    } finally {
      setBulkApproving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Buyer Workspace Queue</h1>
          <p className="text-xs text-slate-500 mt-1">
            Requisition requirements consolidated by item & plant, ready for commercial approval or override.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Secondary Bulk Action */}
          <button
            onClick={handleApproveAllClean}
            disabled={bulkApproving || filteredRequirements.filter((r) => r.status === 'pending').length === 0}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
          >
            {bulkApproving ? 'Approving...' : 'Approve all clean ones'}
          </button>

          {/* Primary Action Button */}
          <button
            onClick={handleReviewNext}
            disabled={filteredRequirements.filter((r) => r.status === 'pending').length === 0}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5"
          >
            <Sparkles className="w-4 h-4" />
            <span>Review next requirement</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-center space-x-1.5 text-slate-600 font-medium">
          <Filter className="w-4 h-4 text-slate-400" />
          <span>Filters:</span>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="overridden">Overridden</option>
          </select>
        </div>

        <div>
          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            <option value="">All Routes</option>
            <option value="CONTRACT_PO">CONTRACT_PO</option>
            <option value="SPOT_PO">SPOT_PO</option>
            <option value="EMERGENCY_PO">EMERGENCY_PO</option>
            <option value="RFQ">RFQ</option>
            <option value="RFP">RFP</option>
            <option value="CAPEX_SOURCING">CAPEX_SOURCING</option>
            <option value="NEW_ITEM_SOURCING">NEW_ITEM_SOURCING</option>
          </select>
        </div>

        <div>
          <select
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            <option value="">All Plants</option>
            <option value="PUN1">PUN1 (Bhosari)</option>
            <option value="CHK1">CHK1 (Chakan)</option>
          </select>
        </div>

        <div className="flex items-center space-x-1.5 ml-auto">
          <input
            type="checkbox"
            id="clean-filter"
            checked={cleanOnly}
            onChange={(e) => setCleanOnly(e.target.checked)}
            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <label htmlFor="clean-filter" className="text-slate-700 cursor-pointer">
            Clean only (no warnings)
          </label>
        </div>
      </div>

      {/* Requirements Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-4 py-3">Group ID</th>
                <th className="px-4 py-3">Plant</th>
                <th className="px-4 py-3">Item Code</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Group Value</th>
                <th className="px-4 py-3">Decision Route</th>
                <th className="px-4 py-3">Supplier / Suggestions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRequirements.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 italic">
                    {loading ? 'Loading requirements queue...' : 'No requirements matching the filter criteria.'}
                  </td>
                </tr>
              ) : (
                filteredRequirements.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-sky-700">
                      {req.group_id || req.id}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{req.plant}</td>
                    <td className="px-4 py-3 font-mono text-slate-900">{req.item_code}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {req.total_quantity} {req.uom}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      Rs {req.group_value_inr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                          req.route === 'CONTRACT_PO'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.route === 'EMERGENCY_PO'
                            ? 'bg-rose-100 text-rose-800'
                            : req.route === 'SPOT_PO'
                            ? 'bg-sky-100 text-sky-800'
                            : req.route === 'CAPEX_SOURCING'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {req.route}
                      </span>
                      {req.flags && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(typeof req.flags === 'string' ? JSON.parse(req.flags) : req.flags).map(
                            (f: string, i: number) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded text-[9px] bg-purple-50 text-purple-700 font-mono border border-purple-200"
                              >
                                {f}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]">
                      {req.supplier_id ? (
                        <span className="font-mono text-purple-700 font-semibold">{req.supplier_id}</span>
                      ) : (
                        req.suggested_suppliers || 'None'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          req.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : req.status === 'overridden'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onSelectRequirement(req.id)}
                        className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-100 hover:bg-sky-50 hover:text-sky-700 text-slate-700 rounded text-xs font-semibold transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Review</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
