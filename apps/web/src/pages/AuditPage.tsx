import React, { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { History, Filter, FileText, ChevronDown, ChevronRight } from 'lucide-react';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getAuditLogs({
        entity_type: entityFilter || undefined,
        actor: actorFilter || undefined,
      });
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [entityFilter, actorFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">System Audit Log</h1>
        <p className="text-xs text-slate-500 mt-1">
          Append-only tamper-proof audit trail for approvals, overrides, and policy changes.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center space-x-4 text-xs">
        <Filter className="w-4 h-4 text-slate-400" />
        <div>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            <option value="">All Entity Types</option>
            <option value="Requirement">Requirement</option>
            <option value="PolicyVersion">PolicyVersion</option>
            <option value="PolicyChangeSet">PolicyChangeSet</option>
            <option value="Contract">Contract</option>
            <option value="System">System</option>
          </select>
        </div>

        <div>
          <input
            type="text"
            placeholder="Filter by actor..."
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity ID</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor (Role)</th>
                <th className="px-4 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 italic">
                    {loading ? 'Loading audit records...' : 'No audit entries found.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{log.entity_type}</td>
                        <td className="px-4 py-3 font-mono text-sky-700">{log.entity_id}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 uppercase">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-900">{log.actor}</span>
                          <span className="text-slate-500 ml-1">({log.role})</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {log.diff_json && (
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="text-sky-600 hover:text-sky-800 inline-flex items-center space-x-1"
                            >
                              <span>Diff</span>
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && log.diff_json && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-slate-900 text-emerald-400 font-mono text-[11px]">
                            <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(JSON.parse(log.diff_json), null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
