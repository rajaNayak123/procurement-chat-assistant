import React from 'react';
import { X, CheckCircle, ShieldCheck, Scale, Cpu, FileText } from 'lucide-react';

interface DecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DecisionModal: React.FC<DecisionModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-2">
            <Cpu className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-bold text-slate-900">How Decisions Are Made (Engine Rules)</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-700 leading-relaxed">
          {/* Section 1: Order of Evaluation */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center space-x-2">
              <Scale className="w-4 h-4 text-sky-600" />
              <span>1. Decision Rule Hierarchy (First Match Wins)</span>
            </h3>
            <div className="space-y-2 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.1 Capex:</span>
                <span>Item type Capex &rarr; <b className="text-purple-700">CAPEX_SOURCING</b> (suggests 5 suppliers, requires capex approval).</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.2 Contract:</span>
                <span>Active valid contract covers item with remaining ceiling &rarr; <b className="text-emerald-700">CONTRACT_PO</b> (placed at contract rate).</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.3 Emerg:</span>
                <span>Emergency request &le; Rs 5,00,000 & bought in last 365d from Active supplier &rarr; <b className="text-rose-700">EMERGENCY_PO</b> (1st preferred supplier).</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.4 Spot:</span>
                <span>Requirement value &lt; Rs 2,00,000 & bought in last 365d from Active supplier &rarr; <b className="text-blue-700">SPOT_PO</b> (1st preferred supplier).</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.5 RFQ:</span>
                <span>Requirement value &lt; Rs 10,00,000 (includes small uncataloged items) &rarr; <b className="text-amber-700">RFQ</b> (suggests 3 suppliers).</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-bold text-sky-700 w-12">5.6 RFP:</span>
                <span>Requirement value &ge; Rs 10,00,000 &rarr; <b className="text-orange-700">RFP</b> (suggests 5 suppliers).</span>
              </div>
            </div>
          </div>

          {/* Section 2: Anti-Splitting Clubbing */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center space-x-2">
              <FileText className="w-4 h-4 text-sky-600" />
              <span>2. Anti-Splitting Clubbing Logic (Policy Section 2)</span>
            </h3>
            <p className="mb-2">
              Requisition lines are sorted by creation date, PR number, and line number. A line joins an existing requirement if:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 text-slate-600">
              <li><b>Same resolved item code</b> and <b>same plant</b> (lines for PUN1 and CHK1 never merge).</li>
              <li>Created within <b>14 calendar days</b> of the requirement's first line.</li>
              <li>Need-by date within <b>7 days either side</b> (inclusive) of the first line's need-by date.</li>
              <li>NEW items are <b>never clubbed</b> to ensure transparent discoverability.</li>
              <li>Any Emergency line elevates the whole requirement to Emergency.</li>
            </ul>
          </div>

          {/* Section 3: Preferred Supplier Ranking */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-sky-600" />
              <span>3. Preferred Supplier Ranking Formula (Policy Section 6)</span>
            </h3>
            <p className="font-mono bg-slate-100 p-2.5 rounded border border-slate-200 text-[11px] text-slate-800">
              Score = 0.30 &times; (POs / max POs) + 0.25 &times; Recency + 0.20 &times; Contract + 0.15 &times; (On-Time % / 100) + 0.10 &times; (Quality / 5)
            </p>
            <p className="mt-1 text-slate-600">
              Recency = 1.0 (last PO &le; 90 days), 0.5 (&le; 365 days), else 0. Contract = 1.0 if a contract started on or before date. Tie-breakers: most recent PO date &rarr; higher on-time % &rarr; lower supplier ID.
            </p>
          </div>

          {/* Section 4: Invariants */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>4. Hard Compliance Invariants (Rule 5.7)</span>
            </h3>
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-rose-900">
              <b>Zero Blocked/Inactive Tolerance:</b> Suppliers with status <code>Blocked</code> or <code>Inactive</code> (e.g. S004, S008, S011, S031, S034) are unconditionally excluded from receiving purchase orders, suggested sourcing lists, and manual overrides.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
