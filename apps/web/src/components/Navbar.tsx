import React from 'react';
import { useCurrentUser, DEMO_USERS } from '../context/UserContext.js';
import {
  MessageSquare,
  UploadCloud,
  ListOrdered,
  ScrollText,
  FileCheck2,
  Users,
  History,
  HelpCircle,
  ShieldAlert,
} from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  policyVersion?: string;
  onOpenHowItWorks: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  policyVersion = '5.0',
  onOpenHowItWorks,
}) => {
  const { user, setUser } = useCurrentUser();

  const navItems = [
    { id: 'chat', label: 'Chat Intake', icon: MessageSquare },
    { id: 'batch', label: 'Batch Upload', icon: UploadCloud },
    { id: 'buyer', label: 'Buyer Queue', icon: ListOrdered },
    { id: 'policy', label: 'Policy Governance', icon: ScrollText },
    { id: 'contracts', label: 'Contracts', icon: FileCheck2 },
    { id: 'suppliers', label: 'Preferred Suppliers', icon: Users },
    { id: 'audit', label: 'Audit Log', icon: History },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Company */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-xl shadow-md">
              CE
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-slate-900 tracking-tight">Corvo Engineering</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800">
                  PR-to-PO
                </span>
              </div>
              <p className="text-xs text-slate-500">PUN1 Bhosari • CHK1 Chakan</p>
            </div>
          </div>

          {/* Policy Version Chip & How It Works */}
          <div className="hidden md:flex items-center space-x-3">
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">
              <span className="w-2 h-2 mr-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              Policy v{policyVersion} in force
            </div>

            <button
              onClick={onOpenHowItWorks}
              className="inline-flex items-center space-x-1 text-xs text-slate-600 hover:text-sky-600 font-medium px-2.5 py-1 rounded-md border border-slate-200 hover:border-sky-300 transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>How decisions are made</span>
            </button>
          </div>

          {/* User Profile & Demo Switcher */}
          <div className="flex items-center space-x-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-slate-900">{user.name}</p>
              <p className="text-[10px] text-sky-600 font-medium uppercase tracking-wider">{user.role}</p>
            </div>

            <select
              value={user.email}
              onChange={(e) => {
                const found = DEMO_USERS.find((u) => u.email === e.target.value);
                if (found) setUser(found);
              }}
              className="text-xs bg-slate-50 border border-slate-300 text-slate-700 rounded-md px-2 py-1.5 font-medium focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {DEMO_USERS.map((u) => (
                <option key={u.email} value={u.email}>
                  Sign in as: {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 overflow-x-auto py-2 scrollbar-none border-t border-slate-100">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-sky-600' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
