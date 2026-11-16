import React, { useState } from 'react';
import { api } from '../api/client.js';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
} from 'lucide-react';

export const BatchPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [rawCsv, setRawCsv] = useState('');
  const [persist, setPersist] = useState(false);
  const [policyVersion, setPolicyVersion] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProcessBatch = async () => {
    if (!file && !rawCsv.trim()) {
      setError('Please select a CSV file or paste CSV content.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (file) {
        formData.append('file', file);
      } else {
        const blob = new Blob([rawCsv], { type: 'text/csv' });
        formData.append('file', blob, 'pasted_batch.csv');
      }

      const res = await api.processBatch(formData, persist, policyVersion || undefined);
      setResults(res);
    } catch (err: any) {
      setError(err.message || 'Failed to process batch');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDecisionsCsv = () => {
    if (!results || !results.outputRows) return;
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

    const csvContent =
      columns.join(',') +
      '\n' +
      results.outputRows
        .map((r: any) =>
          columns
            .map((col) => {
              const val = r[col] !== undefined && r[col] !== null ? String(r[col]) : '';
              return val.includes(',') || val.includes('\n') || val.includes('"')
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            })
            .join(',')
        )
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `decisions_run_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">PR Batch Processing</h1>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic evaluation of bulk purchase requests against policy rules, contracts, and PO history.
          </p>
        </div>
        {results && (
          <button
            onClick={handleDownloadDecisionsCsv}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export Decisions CSV</span>
          </button>
        )}
      </div>

      {/* Upload & Config Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* File Dropzone */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Select Batch CSV File
            </label>
            <div className="border-2 border-dashed border-slate-300 hover:border-sky-400 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/50">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setFile(e.target.files[0]);
                  }
                }}
                className="hidden"
                id="batch-file-input"
              />
              <label htmlFor="batch-file-input" className="cursor-pointer">
                <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">
                  {file ? file.name : 'Click or drag & drop sample_pr_batch.csv'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">UTF-8 CSV format</p>
              </label>
            </div>
          </div>

          {/* Configuration Options */}
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Execution Settings
            </label>

            <div className="flex items-center space-x-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input
                type="checkbox"
                id="persist-toggle"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              <label htmlFor="persist-toggle" className="text-xs text-slate-800">
                <span className="font-semibold">Persist into Workspace:</span> Load generated requirements and POs into Buyer Queue
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                What-If Policy Version Override (Optional)
              </label>
              <input
                type="text"
                value={policyVersion}
                onChange={(e) => setPolicyVersion(e.target.value)}
                placeholder="e.g. 5.1 (leave empty for automatic effective date)"
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
            </div>

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                disabled={loading || (!file && !rawCsv.trim())}
                onClick={handleProcessBatch}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold shadow-sm flex items-center justify-center space-x-2 transition-all"
              >
                {loading ? (
                  <>
                    <RotateCcw className="w-4 h-4 animate-spin" />
                    <span>Processing Batch...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Process Batch</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Results View */}
      {results && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">Input Lines</span>
              <p className="text-xl font-bold text-slate-900 mt-1">{results.summary.totalInputLines}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">Processed</span>
              <p className="text-xl font-bold text-emerald-600 mt-1">{results.summary.processedLines}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">Invalid Rows</span>
              <p className="text-xl font-bold text-rose-600 mt-1">{results.summary.notProcessedLines}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">Requirements</span>
              <p className="text-xl font-bold text-sky-600 mt-1">{results.summary.totalRequirements}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">POs Created</span>
              <p className="text-xl font-bold text-purple-600 mt-1">{results.summary.totalPOs}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
              <span className="text-[11px] font-medium text-slate-500 uppercase">Policy Version</span>
              <p className="text-xs font-bold text-slate-800 mt-2">
                {results.summary.policyVersionsUsed.join(', ') || '5.0'}
              </p>
            </div>
          </div>

          {/* Decisions Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Decisions Output ({results.outputRows.length} lines)
              </h3>
            </div>
            <div className="overflow-x-auto max-h-[500px]">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-100/75 sticky top-0 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3 py-2.5">PR / Line</th>
                    <th className="px-3 py-2.5">Item Code</th>
                    <th className="px-3 py-2.5">Group ID</th>
                    <th className="px-3 py-2.5">PO ID</th>
                    <th className="px-3 py-2.5">Decision</th>
                    <th className="px-3 py-2.5">Route</th>
                    <th className="px-3 py-2.5">Supplier</th>
                    <th className="px-3 py-2.5">Unit Price</th>
                    <th className="px-3 py-2.5">Group Value</th>
                    <th className="px-3 py-2.5">Suggested</th>
                    <th className="px-3 py-2.5">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {results.outputRows.map((row: any, idx: number) => {
                    const isError = row.route === 'NOT_PROCESSED';
                    return (
                      <tr key={idx} className={isError ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                        <td className="px-3 py-2 font-mono text-slate-800">
                          {row.pr_no}/{row.pr_line}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700">{row.resolved_item_code || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{row.group_id || '—'}</td>
                        <td className="px-3 py-2 font-mono text-purple-700 font-semibold">{row.po_id || '—'}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              row.decision === 'PO'
                                ? 'bg-emerald-100 text-emerald-800'
                                : row.decision === 'SOURCING_REQUEST'
                                ? 'bg-amber-100 text-amber-800'
                                : 'text-slate-400'
                            }`}
                          >
                            {row.decision || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] ${
                              row.route === 'CONTRACT_PO'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : row.route === 'EMERGENCY_PO'
                                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                : row.route === 'SPOT_PO'
                                ? 'bg-sky-50 text-sky-800 border border-sky-200'
                                : row.route === 'CAPEX_SOURCING'
                                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                                : row.route === 'NOT_PROCESSED'
                                ? 'bg-rose-100 text-rose-900 font-bold'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {row.route}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono">{row.supplier_id || '—'}</td>
                        <td className="px-3 py-2 font-mono">{row.unit_price ? `Rs ${row.unit_price}` : '—'}</td>
                        <td className="px-3 py-2 font-mono font-medium">
                          {row.group_value_inr ? `Rs ${row.group_value_inr}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-500 truncate max-w-[150px]">
                          {row.suggested_supplier_ids || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 truncate max-w-[250px]" title={row.reason}>
                          {row.reason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
