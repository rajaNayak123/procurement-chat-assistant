import React, { useState, useEffect } from 'react';
import { UserProvider } from './context/UserContext.js';
import { Navbar } from './components/Navbar.js';
import { DecisionModal } from './components/DecisionModal.js';
import { ChatPage } from './pages/ChatPage.js';
import { BatchPage } from './pages/BatchPage.js';
import { BuyerQueuePage } from './pages/BuyerQueuePage.js';
import { RequirementDetailPage } from './pages/RequirementDetailPage.js';
import { PolicyPage } from './pages/PolicyPage.js';
import { ContractsPage } from './pages/ContractsPage.js';
import { PreferredSuppliersPage } from './pages/PreferredSuppliersPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { api } from './api/client.js';

export function AppContent() {
  const [currentTab, setCurrentTab] = useState<string>('chat');
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [policyVersion, setPolicyVersion] = useState('5.0');

  useEffect(() => {
    async function loadPolicyInfo() {
      try {
        const p = await api.getActivePolicy();
        if (p?.version) setPolicyVersion(p.version);
      } catch {}
    }
    loadPolicyInfo();
  }, []);

  const handleSelectRequirement = (id: string) => {
    setSelectedRequirementId(id);
    setCurrentTab('requirement-detail');
  };

  const handleBackToQueue = () => {
    setSelectedRequirementId(null);
    setCurrentTab('buyer');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setSelectedRequirementId(null);
          setCurrentTab(tab);
        }}
        policyVersion={policyVersion}
        onOpenHowItWorks={() => setShowHowItWorks(true)}
      />

      <main className="flex-1 pb-12">
        {currentTab === 'chat' && <ChatPage />}
        {currentTab === 'batch' && <BatchPage />}
        {currentTab === 'buyer' && (
          <BuyerQueuePage onSelectRequirement={handleSelectRequirement} />
        )}
        {currentTab === 'requirement-detail' && selectedRequirementId && (
          <RequirementDetailPage
            requirementId={selectedRequirementId}
            onBack={handleBackToQueue}
          />
        )}
        {currentTab === 'policy' && <PolicyPage />}
        {currentTab === 'contracts' && <ContractsPage />}
        {currentTab === 'suppliers' && <PreferredSuppliersPage />}
        {currentTab === 'audit' && <AuditPage />}
        {currentTab === 'admin' && <AdminPage />}
      </main>

      {/* Decision Rules Explainer Modal */}
      <DecisionModal
        isOpen={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <UserProvider>
      <AppContent />
    </UserProvider>
  );
}
