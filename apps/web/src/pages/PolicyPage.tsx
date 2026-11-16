import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useCurrentUser } from '../context/UserContext.js';
import {
  ScrollText,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileCode,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Sliders,
  FileText,
} from 'lucide-react';

export const PolicyPage: React.FC = () => {
  const { user } = useCurrentUser();
  const [activePolicy, setActivePolicy] = useState<any | null>(null);
  const [readableRules, setReadableRules] = useState<string[]>([]);
  const [showJson, setShowJson] = useState(false);

  // Mode: 'text' (NLP / doc upload) or 'form' (Structured Form Editor)
  const [editorMode, setEditorMode] = useState<'text' | 'form'>('text');
  const [formNotice, setFormNotice] = useState<string | null>(null);

  // Amendment Input (NLP / doc)
  const [inputText, setInputText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  // Structured Form Editor Fields
  const [formTargetVersion, setFormTargetVersion] = useState('5.1');
  const [formEffectiveFrom, setFormEffectiveFrom] = useState('2026-11-25');
  const [formSpotLimit, setFormSpotLimit] = useState<string>('');
  const [formEmergencyLimit, setFormEmergencyLimit] = useState<string>('');
  const [formClubbingDays, setFormClubbingDays] = useState<string>('');
  const [formConsolidationHours, setFormConsolidationHours] = useState<string>('');
  const [formMinOnTime, setFormMinOnTime] = useState<string>('');
  const [formWithdrawRuleId, setFormWithdrawRuleId] = useState<string>('');
  const [formNewCategory, setFormNewCategory] = useState<string>('');
  const [formNewPlant, setFormNewPlant] = useState<string>('');
  const [formNewSpotLimit, setFormNewSpotLimit] = useState<string>('');

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
    setFormNotice(null);

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
      if (err.needs_form_editor) {
        setEditorMode('form');
        setFormNotice('No operations could be automatically extracted from your input. Please configure your changes in the Structured Form Editor below.');
      } else {
        alert(`Extraction failed: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitStructuredForm = async () => {
    setLoading(true);
    setSuccessMessage(null);
    setFormNotice(null);

    const operations: any[] = [];
    if (formSpotLimit) {
      operations.push({
        op: 'set_param',
        param: 'spot_limit',
        value: parseFloat(formSpotLimit),
        citation: `Form: Set spot limit to Rs ${formSpotLimit}`,
      });
    }
    if (formEmergencyLimit) {
      operations.push({
        op: 'set_param',
        param: 'emergency_limit',
        value: parseFloat(formEmergencyLimit),
        citation: `Form: Set emergency limit to Rs ${formEmergencyLimit}`,
      });
    }
    if (formClubbingDays) {
      operations.push({
        op: 'set_param',
        param: 'club_created_within_days',
        value: parseInt(formClubbingDays, 10),
        citation: `Form: Set clubbing window to ${formClubbingDays} days`,
      });
    }
    if (formConsolidationHours) {
      operations.push({
        op: 'set_param',
        param: 'consolidation_window_hours',
        value: parseInt(formConsolidationHours, 10),
        citation: `Form: Set consolidation window to ${formConsolidationHours} hours`,
      });
    }
    if (formMinOnTime) {
      operations.push({
        op: 'set_param',
        param: 'ranking.min_on_time_pct',
        value: parseInt(formMinOnTime, 10),
        citation: `Form: Set minimum on-time threshold to ${formMinOnTime}%`,
      });
    }
    if (formWithdrawRuleId) {
      operations.push({
        op: 'disable_rule',
        rule_id: formWithdrawRuleId,
        citation: `Form: Withdrew rule ${formWithdrawRuleId}`,
      });
    }
    if (formNewCategory && formNewSpotLimit) {
      const plant = formNewPlant ? formNewPlant.toUpperCase() : undefined;
      const limit = parseFloat(formNewSpotLimit);
      const ruleId = plant ? `5.3b-${plant.toLowerCase()}` : `5.4-${formNewCategory.toLowerCase().replace(/\s+/g, '_')}`;
      const whenAll: any[] = [
        { field: 'item.category', op: 'eq', value: formNewCategory },
        { field: 'req.value', op: 'lte', value: limit },
        { field: 'history.bought_from_active', args: { days: 365 }, op: 'eq', value: true },
      ];
      if (plant) {
        whenAll.unshift({ field: 'plant', op: 'eq', value: plant });
      }
      operations.push({
        op: 'add_rule',
        position: 3,
        rule: {
          id: ruleId,
          name: `Spot_${formNewCategory}${plant ? '_' + plant : ''}`,
          enabled: true,
          when: { all: whenAll },
          then: {
            decision: 'PO',
            route: 'SPOT_PO',
            supplier: 'preferred_1',
            price: 'reference_price',
          },
        },
        citation: `Form: Added spot rule for ${formNewCategory}${plant ? ' at ' + plant : ''} up to ${limit}`,
      });
    }

    if (operations.length === 0) {
      alert('Please fill at least one parameter or rule change in the form.');
      setLoading(false);
      return;
    }

    try {
      const res = await api.submitFormPolicyChange({
        target_version: formTargetVersion || '5.1',
        effective_from: formEffectiveFrom || '2026-11-25',
        operations,
      });

      setExtractedReview(res);
      setTargetVersion(res.changeSet.target_version);
      setEffectiveDate(res.changeSet.effective_from);
    } catch (err: any) {
      alert(`Structured form failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveAndActivate = async () => {
    if (!extractedReview) return;

    // Check assumptions
    const assumptions = extractedReview.changeSet?.assumptions || [];
    const confirmedAssumptions = assumptions.filter((_: string, idx: number) => acknowledgedAssumptions[idx]);
    if (assumptions.length > 0 && confirmedAssumptions.length < assumptions.length) {
      alert(`Approval blocked: Please review and check all ${assumptions.length} assumptions before approval.`);
      return;
    }

    // Check lint errors
    const hasLintErrors = extractedReview.lintIssues?.some((i: any) => i.severity === 'error');
    if (hasLintErrors) {
      alert('Approval blocked: Candidate policy contains lint errors that must be resolved first.');
      return;
    }

    setApprovalLoading(true);

    try {
      const res = await api.approvePolicyChange(extractedReview.change_set_id, {
        actor: user.name,
        role: user.role,
        version: targetVersion,
        effective_from: effectiveDate,
        comment: approvalComment || 'Approved by Procurement Head',
        confirmed_assumptions: confirmedAssumptions,
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
          Zero-code versioned procurement rules. Upload amendment documents, describe changes in plain English, or use the structured form editor.
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

      {/* Editor Tabs & Authoring Box */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-sky-600" />
            <span className="text-sm font-bold text-slate-900">Author Policy Amendment</span>
          </div>
          <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
            <button
              onClick={() => {
                setEditorMode('text');
                setFormNotice(null);
              }}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all ${
                editorMode === 'text'
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Natural Language / Upload</span>
            </button>
            <button
              onClick={() => {
                setEditorMode('form');
                setFormNotice(null);
              }}
              className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-all ${
                editorMode === 'form'
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Structured Form Editor</span>
            </button>
          </div>
        </div>

        {formNotice && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{formNotice}</span>
          </div>
        )}

        {editorMode === 'text' ? (
          <div className="space-y-4">
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
                  Or Describe Change in Formal Sentences
                </label>
                <textarea
                  rows={4}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="e.g. 'The spot limit is raised from Rs 2,00,000 to Rs 3,00,000 with effect from 25 November 2026. Rule 5.3 is withdrawn.'..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>

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
        ) : (
          /* Structured Form Editor */
          <div className="space-y-4">
            <div className="p-4 bg-sky-50/50 border border-sky-100 rounded-lg space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Version</label>
                  <input
                    type="text"
                    value={formTargetVersion}
                    onChange={(e) => setFormTargetVersion(e.target.value)}
                    placeholder="5.1"
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-mono focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={formEffectiveFrom}
                    onChange={(e) => setFormEffectiveFrom(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Parameter Adjustments */}
              <div className="border-t border-slate-200 pt-3">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-2">
                  Parameter Adjustments
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-600 mb-0.5">Spot Limit (INR)</label>
                    <input
                      type="number"
                      value={formSpotLimit}
                      onChange={(e) => setFormSpotLimit(e.target.value)}
                      placeholder={`Current: ${activePolicy?.params?.spot_limit || 200000}`}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-0.5">Emergency Limit (INR)</label>
                    <input
                      type="number"
                      value={formEmergencyLimit}
                      onChange={(e) => setFormEmergencyLimit(e.target.value)}
                      placeholder={`Current: ${activePolicy?.params?.emergency_limit || 500000}`}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-0.5">Clubbing Window (Days)</label>
                    <input
                      type="number"
                      value={formClubbingDays}
                      onChange={(e) => setFormClubbingDays(e.target.value)}
                      placeholder={`Current: ${activePolicy?.params?.club_created_within_days || 14}`}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-0.5">Consolidation Window (Hours)</label>
                    <input
                      type="number"
                      value={formConsolidationHours}
                      onChange={(e) => setFormConsolidationHours(e.target.value)}
                      placeholder={`Current: ${activePolicy?.params?.consolidation_window_hours || 24}`}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-0.5">Minimum On-Time (%)</label>
                    <input
                      type="number"
                      value={formMinOnTime}
                      onChange={(e) => setFormMinOnTime(e.target.value)}
                      placeholder={`Current: ${activePolicy?.params?.ranking?.min_on_time_pct || 'None'}`}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Rule Management */}
              <div className="border-t border-slate-200 pt-3 space-y-3">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                  Rule Actions
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Withdraw / Disable Rule</label>
                    <select
                      value={formWithdrawRuleId}
                      onChange={(e) => setFormWithdrawRuleId(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded p-1.5 text-xs"
                    >
                      <option value="">-- None --</option>
                      {activePolicy?.rules?.map((r: any) => (
                        <option key={r.id} value={r.id}>
                          Rule {r.id}: {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Add Specialized Spot Rule</label>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Plant (e.g. CHK1)"
                        value={formNewPlant}
                        onChange={(e) => setFormNewPlant(e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1 text-[11px]"
                      />
                      <input
                        type="text"
                        placeholder="Category (e.g. Packaging)"
                        value={formNewCategory}
                        onChange={(e) => setFormNewCategory(e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1 text-[11px]"
                      />
                      <input
                        type="number"
                        placeholder="Limit (INR)"
                        value={formNewSpotLimit}
                        onChange={(e) => setFormNewSpotLimit(e.target.value)}
                        className="bg-white border border-slate-300 rounded p-1 text-[11px] font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                disabled={loading}
                onClick={handleSubmitStructuredForm}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center space-x-2"
              >
                <Sliders className="w-4 h-4" />
                <span>{loading ? 'Processing Form...' : 'Generate Change Set & Preview Impact'}</span>
              </button>
            </div>
          </div>
        )}
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

          {/* Retroactive Date Warning */}
          {extractedReview.retroactive_warning && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-semibold">{extractedReview.retroactive_warning}</span>
            </div>
          )}

          {/* Lint Issues Banner */}
          {extractedReview.lintIssues && extractedReview.lintIssues.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 block">Lint Analysis</span>
              <div className="space-y-1.5">
                {extractedReview.lintIssues.map((issue: any, i: number) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-lg text-xs flex items-start space-x-2 border ${
                      issue.severity === 'error'
                        ? 'bg-rose-50 border-rose-300 text-rose-900 font-medium'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${issue.severity === 'error' ? 'text-rose-600' : 'text-amber-600'}`} />
                    <div>
                      <span className="font-bold uppercase text-[10px] mr-1.5">[{issue.severity}]:</span>
                      <span>{issue.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
