import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useCurrentUser } from '../context/UserContext.js';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  Cpu,
  Layers,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Building2,
  Calendar,
  X,
} from 'lucide-react';

interface RequirementDetailPageProps {
  requirementId: string;
  onBack: () => void;
}

export const RequirementDetailPage: React.FC<RequirementDetailPageProps> = ({
  requirementId,
  onBack,
}) => {
  const { user } = useCurrentUser();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trace collapse state
  const [showTrace, setShowTrace] = useState(false);

  // Override Modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideComment, setOverrideComment] = useState('');
  const [overrideRoute, setOverrideRoute] = useState('');
  const [overrideSupplierId, setOverrideSupplierId] = useState('');
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await api.getRequirement(requirementId);
      setData(res);
      setOverrideRoute(res.requirement.route || 'SPOT_PO');
      setOverrideSupplierId(res.requirement.supplier_id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load requirement details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [requirementId]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-center text-xs text-slate-500">
        Loading requirement details...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button onClick={onBack} className="text-xs text-sky-600 flex items-center space-x-1 mb-4">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to queue</span>
        </button>
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs">
          {error || 'Requirement not found'}
        </div>
      </div>
    );
  }

  const { requirement, lines, preferred_suppliers, candidate_contracts, overrides } = data;
  const isApproved = requirement.status === 'approved';

  let flagsList: string[] = [];
  try {
    if (requirement.flags) {
      flagsList = typeof requirement.flags === 'string' ? JSON.parse(requirement.flags) : requirement.flags;
    }
  } catch {}

  // Primary action button label dynamically adapts (Section 8 Table)
  let approveLabel = 'Approve';
  if (flagsList.includes('needs_capex_approval') || requirement.route === 'CAPEX_SOURCING') {
    approveLabel = user.role === 'Procurement Head' ? 'Approve capex' : 'Send for capex approval';
  } else if (requirement.route?.includes('PO')) {
    approveLabel = requirement.po_id ? `Create PO (${requirement.po_id})` : 'Create PO';
  } else if (requirement.route === 'RFQ') {
    approveLabel = 'Create RFQ';
  } else if (requirement.route === 'RFP') {
    approveLabel = 'Create RFP';
  }

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await api.approveRequirement(requirement.id, {
        actor: user.name,
        role: user.role,
        comment: `Approved by ${user.role} ${user.name}`,
      });
      await fetchDetail();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApplyOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setOverrideError(null);

    if (overrideComment.trim().length < 10) {
      setOverrideError('Comment must be at least 10 characters explaining reason.');
      return;
    }

    setActionLoading(true);
    try {
      await api.overrideRequirement(requirement.id, {
        actor: user.name,
        role: user.role,
        comment: overrideComment,
        new_route: overrideRoute,
        new_supplier_id: overrideSupplierId || undefined,
        new_price: overridePrice ? parseFloat(overridePrice) : undefined,
      });
      setShowOverrideModal(false);
      await fetchDetail();
    } catch (err: any) {
      setOverrideError(err.message || 'Override rejected');
    } finally {
      setActionLoading(false);
    }
  };

  let ruleTraceList: any[] = [];
  try {
    if (requirement.rule_trace) ruleTraceList = JSON.parse(requirement.rule_trace);
  } catch {}

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-600 hover:text-sky-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Buyer Queue</span>
      </button>

      {/* Decision Banner Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3 mb-1">
              <span className="font-mono text-sm font-bold text-sky-800">{requirement.group_id || requirement.id}</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  requirement.route === 'CONTRACT_PO'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : requirement.route === 'EMERGENCY_PO'
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : requirement.route === 'SPOT_PO'
                    ? 'bg-sky-100 text-sky-800 border border-sky-300'
                    : requirement.route === 'CAPEX_SOURCING'
                    ? 'bg-purple-100 text-purple-800 border border-purple-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {requirement.route}
              </span>
              {flagsList.map((f: string, i: number) => (
                <span
                  key={i}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-300"
                >
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                  requirement.status === 'approved'
                    ? 'bg-emerald-50 text-emerald-700'
                    : requirement.status === 'overridden'
                    ? 'bg-purple-50 text-purple-700'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {requirement.status}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1 font-medium">{requirement.reason}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 shrink-0">
            {!isApproved && (
              <button
                onClick={() => setShowOverrideModal(true)}
                disabled={actionLoading}
                className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                Override
              </button>
            )}

            {/* Primary Action */}
            <button
              onClick={handleApprove}
              disabled={isApproved || actionLoading}
              className={`px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5 ${
                isApproved
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isApproved ? 'Approved & Locked' : approveLabel}</span>
            </button>
          </div>
        </div>

        {/* Commercial Breakdown */}
        <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white border-b border-slate-100 text-xs">
          <div>
            <span className="text-slate-500 uppercase text-[10px] font-bold">Requirement Value</span>
            <p className="text-base font-mono font-bold text-slate-900 mt-0.5">
              Rs {requirement.group_value_inr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] font-bold">Valuation Price</span>
            <p className="text-xs font-mono font-semibold text-slate-800 mt-1">
              Rs {requirement.valuation_price.toFixed(2)} ({requirement.valuation_source})
            </p>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] font-bold">Selected Supplier / Price</span>
            <p className="text-xs font-mono font-bold text-purple-700 mt-1">
              {requirement.supplier_id ? `${requirement.supplier_id} @ Rs ${requirement.po_unit_price?.toFixed(2)}` : 'Sourcing Slate'}
            </p>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] font-bold">PO Consolidation</span>
            <p className="text-xs font-mono font-bold text-sky-700 mt-1">
              {requirement.po_id ? requirement.po_id : 'Not consolidated'}
            </p>
          </div>
        </div>
      </div>

      {/* PR Lines forming this Requirement */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          Consolidated Purchase Request Lines ({lines.length} lines)
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2">PR / Line</th>
                <th className="px-3 py-2">Requester</th>
                <th className="px-3 py-2">Item Description</th>
                <th className="px-3 py-2">Quantity</th>
                <th className="px-3 py-2">Need-by Date</th>
                <th className="px-3 py-2">Urgency</th>
                <th className="px-3 py-2">Match Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-bold text-sky-700">{l.pr_no}/{l.pr_line}</td>
                  <td className="px-3 py-2">{l.requester} ({l.department})</td>
                  <td className="px-3 py-2 text-slate-800">{l.description}</td>
                  <td className="px-3 py-2 font-semibold">{l.quantity} {l.uom}</td>
                  <td className="px-3 py-2">{l.need_by_date}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      l.urgency === 'Emergency' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {l.urgency}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{l.match_method} ({Math.round(l.match_confidence * 100)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collapsible Rule Trace */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowTrace(!showTrace)}
          className="w-full px-6 py-4 flex items-center justify-between text-left font-bold text-xs text-slate-800 uppercase tracking-wider bg-slate-50/75 hover:bg-slate-100 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-sky-600" />
            <span>Rule Evaluation Trace (Order of Rules)</span>
          </div>
          {showTrace ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {showTrace && (
          <div className="p-6 border-t border-slate-200 overflow-x-auto text-xs">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold">
                <tr>
                  <th className="px-3 py-2">Rule ID</th>
                  <th className="px-3 py-2">Rule Name</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Evaluation Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ruleTraceList.map((t, idx) => (
                  <tr key={idx} className={t.matched ? 'bg-emerald-50/60 font-semibold' : ''}>
                    <td className="px-3 py-2 font-mono text-sky-800">{t.rule_id}</td>
                    <td className="px-3 py-2">{t.rule_name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        t.matched ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {t.matched ? 'MATCHED' : 'DID NOT MATCH'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <div>{t.reason}</div>
                      {!t.matched && t.failing_field && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-500">
                          <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded border border-rose-200">
                            field: {t.failing_field}
                          </span>
                          <span>actual: {JSON.stringify(t.actual_value)}</span>
                          <span className="font-bold text-slate-700">{t.operator}</span>
                          <span>expected: {JSON.stringify(t.expected_value)}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Candidate Contracts Table */}
      {candidate_contracts && candidate_contracts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-3">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            <span>Candidate Rate Contracts Covering This Item</span>
          </div>
          <div className="overflow-x-auto text-xs">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Contract ID</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Supplier Status</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Validity</th>
                  <th className="px-3 py-2">Ceiling Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidate_contracts.map((c: any) => (
                  <tr key={c.contract_id}>
                    <td className="px-3 py-2 font-mono font-bold text-sky-700">{c.contract_id}</td>
                    <td className="px-3 py-2">{c.supplier_name} ({c.supplier_id})</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.supplier_status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {c.supplier_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">Rs {c.rate?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-slate-600">{c.start_date} to {c.end_date}</td>
                    <td className="px-3 py-2 font-mono">Rs {Math.max(0, c.value_cap - c.consumed_value).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Override Engine Decision</h3>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyOverride} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Written Justification (Mandatory, min 10 chars)
                </label>
                <textarea
                  required
                  rows={3}
                  value={overrideComment}
                  onChange={(e) => setOverrideComment(e.target.value)}
                  placeholder="Explain why the engine decision is being overridden..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">New Route</label>
                <select
                  value={overrideRoute}
                  onChange={(e) => setOverrideRoute(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-sky-500 focus:outline-none"
                >
                  <option value="CONTRACT_PO">CONTRACT_PO</option>
                  <option value="SPOT_PO">SPOT_PO</option>
                  <option value="EMERGENCY_PO">EMERGENCY_PO</option>
                  <option value="RFQ">RFQ</option>
                  <option value="RFP">RFP</option>
                  <option value="CAPEX_SOURCING">CAPEX_SOURCING</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Supplier ID</label>
                <input
                  type="text"
                  value={overrideSupplierId}
                  onChange={(e) => setOverrideSupplierId(e.target.value)}
                  placeholder="e.g. S001"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Guardrail: Blocked or Inactive suppliers are unconditionally prohibited and will be rejected.
                </p>
              </div>

              {overrideError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 text-[11px] flex items-center space-x-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{overrideError}</span>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || overrideComment.trim().length < 10}
                  className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded text-xs font-bold shadow-sm"
                >
                  Save Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
