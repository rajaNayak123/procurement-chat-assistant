const BASE_URL = '/api';

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    let errMessage = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson.error) errMessage = errJson.error;
    } catch {}
    throw new Error(errMessage);
  }
  return res.json();
}

export const api = {
  getHealth: () => apiRequest('/health'),

  // Batch
  processBatch: (formData: FormData, persist: boolean = false, policyVersion?: string) => {
    let url = `/process-batch?persist=${persist}`;
    if (policyVersion) url += `&policy_version=${encodeURIComponent(policyVersion)}`;
    return apiRequest(url, {
      method: 'POST',
      body: formData,
    });
  },
  getBatches: () => apiRequest('/batches'),
  getBatch: (id: string) => apiRequest(`/batches/${id}`),
  reprocessBatch: (id: string, policyVersion?: string) => {
    let url = `/batches/${id}/reprocess`;
    if (policyVersion) url += `?policy_version=${encodeURIComponent(policyVersion)}`;
    return apiRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  },

  // Requirements
  getRequirements: (params: { route?: string; plant?: string; status?: string } = {}) => {
    const q = new URLSearchParams(params as any).toString();
    return apiRequest(`/requirements${q ? '?' + q : ''}`);
  },
  getRequirement: (id: string) => apiRequest(`/requirements/${id}`),
  approveRequirement: (id: string, payload: { actor: string; role: string; comment?: string }) =>
    apiRequest(`/requirements/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  overrideRequirement: (
    id: string,
    payload: {
      actor: string;
      role: string;
      comment: string;
      new_route?: string;
      new_supplier_id?: string;
      new_price?: number;
      new_value?: number;
    }
  ) =>
    apiRequest(`/requirements/${id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // Policy
  getActivePolicy: (date?: string) => apiRequest(`/policy/active${date ? '?date=' + date : ''}`),
  getPolicyVersions: () => apiRequest('/policy/versions'),
  getReadableRules: (v: string) => apiRequest(`/policy/versions/${v}/readable`),
  uploadPolicyChange: (formData: FormData) =>
    apiRequest('/policy/changes', { method: 'POST', body: formData }),
  chatPolicyChange: (text: string) =>
    apiRequest('/policy/changes/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  getPolicyChange: (id: string) => apiRequest(`/policy/changes/${id}`),
  approvePolicyChange: (
    id: string,
    payload: { actor: string; role: string; version?: string; effective_from?: string; comment?: string }
  ) =>
    apiRequest(`/policy/changes/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  rejectPolicyChange: (id: string, payload: { actor: string; role: string; reason?: string }) =>
    apiRequest(`/policy/changes/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // Contracts
  getContracts: () => apiRequest('/contracts'),
  createContract: (payload: any) =>
    apiRequest('/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  extractContractPdf: (formData: FormData) =>
    apiRequest('/contracts/extract-pdf', { method: 'POST', body: formData }),

  // Suppliers & Items
  getItems: () => apiRequest('/items'),
  getSuppliers: () => apiRequest('/suppliers'),
  getPreferredSuppliers: (itemCode: string, asOf?: string) =>
    apiRequest(`/preferred-suppliers?item_code=${encodeURIComponent(itemCode)}${asOf ? '&as_of=' + asOf : ''}`),

  // Chat
  createChatSession: (userName: string) =>
    apiRequest('/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_name: userName }),
    }),
  getChatSession: (id: string) => apiRequest(`/chat/sessions/${id}`),
  sendChatMessage: (sessionId: string, text: string) =>
    apiRequest(`/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  // Master Data & Audit
  importMasterData: (formData: FormData) =>
    apiRequest('/admin/import-master-data', { method: 'POST', body: formData }),
  getAuditLogs: (params: any = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/audit${q ? '?' + q : ''}`);
  },
};
