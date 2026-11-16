import React, { useState } from 'react';
import { api } from '../api/client.js';
import { UploadCloud, CheckCircle2, AlertCircle, Database, FileSpreadsheet } from 'lucide-react';

export const AdminPage: React.FC = () => {
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!files || files.length === 0) {
      setError('Please select files to import.');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }

      const res = await api.importMasterData(formData);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Admin: Import Master Data</h1>
        <p className="text-xs text-slate-500 mt-1">
          Upload master data files (plants, item master, supplier master, PO history, contract register, contract lines, PDF contracts).
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50">
          <input
            type="file"
            multiple
            accept=".csv,.pdf"
            onChange={(e) => setFiles(e.target.files)}
            className="hidden"
            id="admin-master-files"
          />
          <label htmlFor="admin-master-files" className="cursor-pointer block">
            <UploadCloud className="w-12 h-12 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-800">
              {files && files.length > 0
                ? `${files.length} file(s) selected`
                : 'Click or drag & drop master CSVs and contract PDFs'}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Supports: plants.csv, item_master.csv, supplier_master.csv, po_history.csv, contract_register.csv, contract_lines.csv, *.pdf
            </p>
          </label>
        </div>

        {files && files.length > 0 && (
          <div className="space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-200 max-h-40 overflow-y-auto text-xs">
            {Array.from(files).map((f, i) => (
              <div key={i} className="flex items-center space-x-2 text-slate-700">
                <FileSpreadsheet className="w-3.5 h-3.5 text-sky-600" />
                <span>{f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            disabled={uploading || !files || files.length === 0}
            onClick={handleImport}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold shadow-sm flex items-center space-x-2 transition-all"
          >
            <Database className="w-4 h-4" />
            <span>{uploading ? 'Importing Data...' : 'Import Master Data'}</span>
          </button>
        </div>

        {result && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 space-y-2">
            <div className="flex items-center space-x-2 font-bold text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>{result.message}</span>
            </div>
            <pre className="p-2 bg-emerald-100/60 rounded text-[11px] font-mono">
              {JSON.stringify(result.importedCounts, null, 2)}
            </pre>
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
