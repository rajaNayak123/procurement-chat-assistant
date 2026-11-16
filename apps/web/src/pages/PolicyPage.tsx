import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useCurrentUser } from '../context/UserContext.js';
import {
  ScrollText,
  UploadCloud,
  MessageSquare,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Scale,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export const PolicyPage: React.FC = () => {
  const { user } = useCurrentUser();
  const [activePolicy, setActivePolicy] = useState<any | null>(null);
  const [readableRules, setReadableRules] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);

  // Amendment Input
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  // Extracted Review State
  const [extractedReview, setExtractedReview] = useState<any | null>(null);
  const [acknowledgedAssumptions, setAcknowledgedAssumptions] = useState<Record<number, boolean>>({});
  const [targetVersion, setTargetVersion] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchPolicy = async () => {
    try {
      const p = await api.getActivePolicy();
      setActivePolicy(p);
      const readable = await api.getReadableRules(p.version);
      setReadableRules(readable.rules || []);
    } catch (err) {
      console.error('Error fetching policy:', err);
    }
  };

  useEffect(() => {
    fetchPolicy();
  }, []);

  const handleExtractAmendment = async () => {
    if (!file && !inputText.trim()) return;

    setLoading(true);
    setSuccessMessage(null);

    try {
      let res;
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        res = await api.uploadPolicyChange(formData);
      } else {
        res = await api.chatPolicyChange(inputText);
      }

      setExtractedReview(res);
      setTargetVersion(res.changeSet.target_version);
      setEffectiveDate(res.changeSet.effective_from);
    } catch (err: any) {
      alert(`Extraction failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndActivate = async () => {
    if (!extractedReview) return;
    setApprovalLoading(true);

    try {
      const res = await api.approvePolicyChange(extractedReview.change_set_id, {
        actor: user.name,
        role: user.role,
        version: targetVersion,
        effective_from: effectiveDate,
        comment: approvalComment || 'Approved by Procurement Head',
      });

      setSuccessMessage(res.message);
      setExtractedReview(null);
      setFile(null);
      setInputText('');
      await fetchPolicy();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setApprovalLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Policy as Data Governance</h1>
        <p className="text-xs text-slate-500 mt-1">
          Zero-code versioned procurement rules. Upload amendment documents or describe changes in plain English.
        </p>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 flex items-center space-x-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {/* Active Policy Summary Card */}
      {activePolicy && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div className="flex items-center space-x-2">
              <ScrollText className="w-5 h-5 text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Active Policy: {activePolicy.policy_id} (v{activePolicy.version})
              </h2>
            </div>
            <button
              onClick={() => setShowJson(!showJson)}
              className="text-xs text-slate-600 hover:text-sky-600 flex items-center space-x-1 border border-slate-200 px-2.5 py-1 rounded-md"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>{showJson ? 'View Plain Text' : 'View Raw JSON'}</span>
            </button>
          </div>

          {/* Parameters grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50 p-4 rounded-lg">
            <div>
              <span className="text-slate-500 uppercase text-[10px] font-bold">Spot Limit</span>
              <p className="font-mono font-bold text-slate-900 mt-0.5">
                Rs {activePolicy.params.spot_limit?.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <span className="text-slate-500 uppercase text-[10px] font-bold">Emergency Limit</span>
              <p className="font-mono font-bold text-slate-900 mt-0.5">
                Rs {activePolicy.params.emergency_limit?.toLocaleString('en-IN')}
              </p>
            </div>
            <div>
              <span className="text-slate-500 uppercase text-[10px] font-bold">Clubbing Window</span>
              <p className="font-semibold text-slate-900 mt-0.5">
                {activePolicy.params.club_created_within_days} days (7d need-by)
              </p>
            </div>
            <div>
              <span className="text-slate-500 uppercase text-[10px] font-bold">Consolidation</span>
              <p className="font-semibold text-slate-900 mt-0.5">
                {activePolicy.params.consolidation_window_hours} hours
              </p>
            </div>
          </div>

          {/* Rules Presentation */}
          {showJson ? (
            <pre className="p-4 bg-slate-900 text-emerald-400 rounded-lg text-xs overflow-x-auto max-h-80 font-mono">
              {JSON.stringify(activePolicy, null, 2)}
            </pre>
          ) : (
            <div className="space-y-2 text-xs">
              <span className="text-slate-500 uppercase text-[10px] font-bold block">Active Rules (Evaluated in Order)</span>
              <div className="space-y-1.5">
                {readableRules.map((r, i) => (
                  <div key={i} className="p-2.5 bg-slate-50 rounded border border-slate-200 text-slate-800 leading-relaxed">
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload or Describe Amendment */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-sky-600" />
          <span>Upload Amendment or Describe Policy Change</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* File Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Upload Policy / Amendment Document (PDF, DOCX, TXT, MD)
            </label>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-5 text-center bg-slate-50/50">
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
                }}
                className="hidden"
                id="policy-file-input"
              />
              <label htmlFor="policy-file-input" className="cursor-pointer block">
                <UploadCloud className="w-8 h-8 text-slate-400 mx-auto mb-1" />
                <span className="text-xs font-semibold text-slate-700">
                  {file ? file.name : 'Choose file or drag & drop'}
                </span>
              </label>
            </div>
          </div>

          {/* Natural language text box */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Or Describe Change in Plain English
            </label>
            <textarea
              rows={4}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="e.g. 'Raise the spot limit for Packaging to 3 lakh from 25 Nov' or 'At CHK1, Lubricants below 3 lakh may be bought spot'..."
              className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Primary Action Button */}
        <div className="pt-2 flex justify-end">
          <button
            disabled={loading || (!file && !inputText.trim())}
            onClick={handleExtractAmendment}
            className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>{loading ? 'Extracting Change Set...' : 'Extract Changes & Preview Impact'}</span>
          </button>
        </div>
      </div>

      {/* Review Screen (Diff, Citations, Assumptions, Impact Preview) */}
      {extractedReview && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">
          <div className="pb-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-900">
              Review Extracted Policy Changes (Candidate v{targetVersion})
            </h2>
            <p className="text-xs text-slate-500">
              Verify textual diff, exact source sentence citations, and impact on current requirements before activating.
            </p>
          </div>

          {/* Plain-Language Diff */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">Plain-Language Diff</span>
            <div className="space-y-2">
              {extractedReview.diff.summaryLines.map((line: string, i: number) => (
                <div key={i} className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs font-medium text-sky-950 flex items-start space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Assumptions that MUST be acknowledged */}
          {extractedReview.changeSet.assumptions && extractedReview.changeSet.assumptions.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                Extracted Assumptions (Must Acknowledge)
              </span>
              <div className="space-y-2">
                {extractedReview.changeSet.assumptions.map((assump: string, i: number) => (
                  <label key={i} className="flex items-start space-x-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!acknowledgedAssumptions[i]}
                      onChange={(e) =>
                        setAcknowledgedAssumptions({ ...acknowledgedAssumptions, [i]: e.target.checked })
                      }
                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500 mt-0.5"
                    />
                    <span className="text-xs text-amber-900">{assump}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Impact Preview */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
              Impact Preview on Current Workspace Requirements
            </span>
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
              <p className="font-semibold text-slate-800">
                {extractedReview.impactPreview.affectedRequirementsCount} of {extractedReview.impactPreview.totalRequirementsCount} requirements change decision route, supplier, or value.
              </p>
              {extractedReview.impactPreview.changes.length > 0 && (
                <div className="mt-3 space-y-1.5 overflow-x-auto">
                  {extractedReview.impactPreview.changes.map((c: any, i: number) => (
                    <div key={i} className="flex items-center space-x-3 py-1 border-b border-slate-200 text-[11px]">
                      <span className="font-mono font-bold text-sky-700">{c.group_id}</span>
                      <span className="text-slate-600">({c.item_code} @ {c.plant}):</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{c.old_route}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">{c.new_route}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Approval Action Form */}
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Effective Date</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Version Label</label>
              <input
                type="text"
                value={targetVersion}
                onChange={(e) => setTargetVersion(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:ring-1 focus:ring-sky-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Approval Comment</label>
              <input
                type="text"
                value={approvalComment}
                onChange={(e) => setApprovalComment(e.target.value)}
                placeholder="e.g. Approved per Q4 procurement review"
                className="w-full bg-slate-50 border border-slate-300 rounded p-2 focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="flex justify-end pt-2">
            <button
              disabled={approvalLoading}
              onClick={handleApproveAndActivate}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{approvalLoading ? 'Activating...' : 'Approve and activate'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
