import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import {
  FileCheck2,
  Plus,
  UploadCloud,
  X,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Layers,
} from 'lucide-react';

export const ContractsPage: React.FC = () => {
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  // Manual Form
  const [contractId, setContractId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [valueCap, setValueCap] = useState('');
  const [lines, setLines] = useState<Array<{ item_code: string; description: string; uom: string; rate: string }>>([
    { item_code: '', description: '', uom: 'NOS', rate: '' },
  ]);

  // PDF Extract Form
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [extractedPdfData, setExtractedPdfData] = useState<any | null>(null);

  const fetchContracts = async () => {
    setLoading(true);
    try {
      const data = await api.getContracts();
      setContracts(data);
    } catch (err) {
      console.error('Failed to load contracts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContracts();
  }, []);

  const handleCreateManualContract = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createContract({
        contract_id: contractId,
        supplier_id: supplierId,
        start_date: startDate,
        end_date: endDate,
        value_cap: parseFloat(valueCap),
        lines: lines.map((l) => ({
          item_code: l.item_code,
          description: l.description,
          uom: l.uom,
          rate: parseFloat(l.rate),
        })),
        source: 'manual',
      });
      setShowManualModal(false);
      await fetchContracts();
    } catch (err: any) {
      alert(`Error creating contract: ${err.message}`);
    }
  };

  const handleUploadAndExtractPdf = async () => {
    if (!pdfFile) return;
    setPdfExtracting(true);
    try {
      const formData = new FormData();
      formData.append('file', pdfFile);
      const res = await api.extractContractPdf(formData);
      setExtractedPdfData(res);
    } catch (err: any) {
      alert(`PDF extraction error: ${err.message}`);
    } finally {
      setPdfExtracting(false);
    }
  };

  const handleSaveExtractedPdfContract = async () => {
    if (!extractedPdfData) return;
    try {
      await api.createContract({
        contract_id: extractedPdfData.contract_id,
        supplier_id: extractedPdfData.supplier_id,
        start_date: extractedPdfData.start_date,
        end_date: extractedPdfData.end_date,
        value_cap: extractedPdfData.value_cap,
        lines: extractedPdfData.lines,
        source: 'pdf',
      });
      setShowPdfModal(false);
      setExtractedPdfData(null);
      setPdfFile(null);
      await fetchContracts();
    } catch (err: any) {
      alert(`Error saving contract: ${err.message}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Contract Register & Ceiling Tracking</h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage rate contracts with dynamic ceiling consumption and PDF-only contract extraction.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowPdfModal(true)}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center space-x-1.5"
          >
            <UploadCloud className="w-4 h-4 text-sky-600" />
            <span>Extract from PDF</span>
          </button>

          {/* Primary Action Button */}
          <button
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add contract</span>
          </button>
        </div>
      </div>

      {/* Contracts Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-4 py-3">Contract ID</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Validity</th>
                <th className="px-4 py-3">Ceiling Value</th>
                <th className="px-4 py-3">Consumed</th>
                <th className="px-4 py-3">Remaining</th>
                <th className="px-4 py-3">% Used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 italic">
                    {loading ? 'Loading contract register...' : 'No contracts found.'}
                  </td>
                </tr>
              ) : (
                contracts.map((c) => (
                  <tr key={c.contract_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-sky-700">{c.contract_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{c.supplier_name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{c.supplier_id}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {c.start_date} to {c.end_date}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      Rs {c.value_cap.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      Rs {c.consumed_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-emerald-700">
                      Rs {c.remaining_ceiling.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                        <div
                          className={`h-full ${
                            c.percent_used >= 90
                              ? 'bg-rose-500'
                              : c.percent_used >= 70
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, c.percent_used)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{c.percent_used}%</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          c.validity_status === 'Valid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.validity_status === 'Ceiling nearly used'
                            ? 'bg-amber-100 text-amber-800'
                            : c.validity_status === 'Supplier blocked'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {c.validity_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-medium">
                        {c.source}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Add Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Add Rate Contract Manually</h3>
              <button onClick={() => setShowManualModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualContract} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contract ID</label>
                  <input
                    required
                    type="text"
                    value={contractId}
                    onChange={(e) => setContractId(e.target.value)}
                    placeholder="RC-2026-..."
                    className="w-full bg-slate-50 border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Supplier ID</label>
                  <input
                    required
                    type="text"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    placeholder="S001"
                    className="w-full bg-slate-50 border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Start Date</label>
                  <input
                    required
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">End Date</label>
                  <input
                    required
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ceiling (INR)</label>
                  <input
                    required
                    type="number"
                    value={valueCap}
                    onChange={(e) => setValueCap(e.target.value)}
                    placeholder="2000000"
                    className="w-full bg-slate-50 border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-800 block">Contract Items & Rates</span>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="Item code (ITM-...)"
                      value={l.item_code}
                      onChange={(e) => {
                        const newL = [...lines];
                        newL[i].item_code = e.target.value;
                        setLines(newL);
                      }}
                      className="bg-slate-50 border border-slate-300 rounded p-1.5 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) => {
                        const newL = [...lines];
                        newL[i].description = e.target.value;
                        setLines(newL);
                      }}
                      className="bg-slate-50 border border-slate-300 rounded p-1.5 col-span-2"
                    />
                    <input
                      type="number"
                      placeholder="Rate (INR)"
                      value={l.rate}
                      onChange={(e) => {
                        const newL = [...lines];
                        newL[i].rate = e.target.value;
                        setLines(newL);
                      }}
                      className="bg-slate-50 border border-slate-300 rounded p-1.5 font-mono"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-bold shadow-sm"
                >
                  Save Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PDF Extract Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Extract Contract from PDF</h3>
              <button onClick={() => setShowPdfModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!extractedPdfData ? (
              <div className="space-y-4 text-xs">
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center bg-slate-50">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) setPdfFile(e.target.files[0]);
                    }}
                    className="hidden"
                    id="contract-pdf-input"
                  />
                  <label htmlFor="contract-pdf-input" className="cursor-pointer block">
                    <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">
                      {pdfFile ? pdfFile.name : 'Select Signed Contract PDF (e.g. RC-2026-031.pdf)'}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Extracts rate schedule and ceiling</p>
                  </label>
                </div>

                <div className="flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowPdfModal(false)}
                    className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!pdfFile || pdfExtracting}
                    onClick={handleUploadAndExtractPdf}
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded text-xs font-bold shadow-sm"
                  >
                    {pdfExtracting ? 'Extracting Fields...' : 'Extract Fields'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Fields extracted successfully via {extractedPdfData.extraction_method}! Verify below before saving:</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-500 font-medium">Contract ID</span>
                    <input
                      type="text"
                      value={extractedPdfData.contract_id}
                      onChange={(e) => setExtractedPdfData({ ...extractedPdfData, contract_id: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 mt-0.5 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">Supplier ID & Name</span>
                    <input
                      type="text"
                      value={extractedPdfData.supplier_id}
                      onChange={(e) => setExtractedPdfData({ ...extractedPdfData, supplier_id: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 mt-0.5 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 font-medium">Start Date</span>
                    <input
                      type="date"
                      value={extractedPdfData.start_date}
                      onChange={(e) => setExtractedPdfData({ ...extractedPdfData, start_date: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">End Date</span>
                    <input
                      type="date"
                      value={extractedPdfData.end_date}
                      onChange={(e) => setExtractedPdfData({ ...extractedPdfData, end_date: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 mt-0.5"
                    />
                  </div>
                  <div>
                    <span className="text-slate-500 font-medium">Ceiling Value (INR)</span>
                    <input
                      type="number"
                      value={extractedPdfData.value_cap}
                      onChange={(e) => setExtractedPdfData({ ...extractedPdfData, value_cap: parseFloat(e.target.value) })}
                      className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 mt-0.5 font-mono font-bold"
                    />
                  </div>
                </div>

                <div>
                  <span className="font-bold text-slate-800 block mb-1">Schedule A Item Rates</span>
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50 space-y-1">
                    {extractedPdfData.lines.map((l: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1 border-b border-slate-200 text-[11px]">
                        <span className="font-mono font-bold text-sky-700">{l.item_code}</span>
                        <span className="text-slate-700">{l.description}</span>
                        <span className="font-mono font-bold">Rs {l.rate?.toFixed(2)} / {l.uom}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setExtractedPdfData(null)}
                    className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded text-xs"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveExtractedPdfContract}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm"
                  >
                    Confirm & Save Contract
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
