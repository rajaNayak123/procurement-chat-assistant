import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';
import { useCurrentUser } from '../context/UserContext.js';
import {
  Send,
  Bot,
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  Sparkles,
  RotateCcw,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  metadata?: any;
  created_at?: string;
}

export const ChatPage: React.FC = () => {
  const { user } = useCurrentUser();
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<any>({
    lines: [{}],
    active_line_index: 0,
    missing_slots: ['item', 'quantity', 'plant', 'need_by_date', 'urgency'],
    ready_to_confirm: false,
  });
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [submittedPr, setSubmittedPr] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize session
  useEffect(() => {
    async function initSession() {
      try {
        const res = await api.createChatSession(user.name);
        setSessionId(res.session.id);
        setMessages([
          {
            id: 'init-1',
            sender: 'assistant',
            text: res.welcomeMessage || 'Hello! I am your AI Requisition Assistant at Corvo Engineering. What materials or services do you need to procure today?',
          },
        ]);
        setQuickReplies([
          'Need 200 nitrile gloves for Chakan by next Friday',
          'brg 6205 2rs 50 pcs PUN1 emergency by tomorrow',
          'Need 2 laptops and 5 monitors for Bhosari by 30 Nov',
        ]);
      } catch (err) {
        console.error('Failed to init session:', err);
      }
    }
    initSession();
  }, [user.name]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || !sessionId || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    try {
      const res = await api.sendChatMessage(sessionId, text);
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: res.reply,
        metadata: res.quickReplies ? { quickReplies: res.quickReplies } : undefined,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setState(res.state);
      setQuickReplies(res.quickReplies || []);
      if (res.prNumber) {
        setSubmittedPr(res.prNumber);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: `Error: ${err.message || 'Failed to process requisition message'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const activeLine = state.lines?.[state.active_line_index || 0] || {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Chat Container (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-[75vh]">
          {/* Chat Header */}
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-slate-800">Requisition Intake Assistant</h2>
                <p className="text-[10px] text-slate-500">Natural language PR creation with policy validation</p>
              </div>
            </div>
            <button
              onClick={() => handleSendMessage('start over')}
              className="text-xs text-slate-500 hover:text-slate-800 flex items-center space-x-1 px-2 py-1 rounded hover:bg-slate-200/50 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Messages Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex items-start space-x-3 ${m.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    m.sender === 'user'
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {m.sender === 'user' ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.sender === 'user'
                      ? 'bg-sky-600 text-white rounded-tr-none'
                      : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-start space-x-3">
                <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="bg-slate-100 text-slate-600 text-xs px-4 py-2 rounded-xl rounded-tl-none border border-slate-200 flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                  <span className="ml-1 text-[11px]">Evaluating catalog & policy...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick-reply chips */}
          {quickReplies && quickReplies.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 flex flex-wrap gap-1.5 overflow-x-auto">
              {quickReplies.map((qr, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(qr)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    qr.includes('Confirm')
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm font-semibold'
                      : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'
                  }`}
                >
                  {qr}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <div className="p-3 border-t border-slate-200 bg-white">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center space-x-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your request e.g. 'need 200 nitrile gloves for Chakan by next Friday'..."
                className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-xs focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || loading}
                className="p-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-lg transition-colors shadow-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Right: Live Draft Card & Transparency (1 col) */}
        <div className="space-y-4">
          {/* Active Requisition Draft */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-sky-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Live Requisition Draft</h3>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                state.ready_to_confirm ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {state.ready_to_confirm ? 'Ready to Submit' : 'Filling Slots'}
              </span>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <span className="text-slate-500 text-[11px] block font-medium">Item Details</span>
                {activeLine.item_code ? (
                  <div className="bg-slate-50 p-2 rounded border border-slate-200 mt-1">
                    <span className="font-mono font-bold text-sky-700 mr-2">{activeLine.item_code}</span>
                    <span className="text-slate-800">{activeLine.description}</span>
                  </div>
                ) : (
                  <span className="italic text-slate-400">Waiting for item description...</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 text-[11px] block font-medium">Quantity</span>
                  <p className="font-semibold text-slate-900 mt-0.5">
                    {activeLine.quantity ? `${activeLine.quantity} ${activeLine.uom || 'NOS'}` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px] block font-medium">Plant</span>
                  <p className="font-semibold text-slate-900 mt-0.5 flex items-center space-x-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{activeLine.plant || '—'}</span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 text-[11px] block font-medium">Need-by Date</span>
                  <p className="font-semibold text-slate-900 mt-0.5 flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{activeLine.need_by_date || '—'}</span>
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px] block font-medium">Urgency</span>
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-0.5 ${
                    activeLine.urgency === 'Emergency' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {activeLine.urgency || '—'}
                  </span>
                </div>
              </div>

              {activeLine.is_new && (
                <div className="bg-purple-50 border border-purple-200 rounded p-2.5 text-purple-900">
                  <span className="font-bold text-[11px] block">Uncataloged / New Item</span>
                  <p className="text-[10px] text-purple-700">Estimated unit price: Rs {activeLine.estimated_unit_price || 'pending'}</p>
                </div>
              )}
            </div>

            {/* Anti-Splitting Transparency Alert */}
            {state.clubbing_notice && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  {state.clubbing_notice}
                </div>
              </div>
            )}

            {/* Primary Action Button */}
            <div className="mt-5 pt-3 border-t border-slate-200">
              <button
                disabled={!state.ready_to_confirm || loading}
                onClick={() => handleSendMessage('Confirm and submit')}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center space-x-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm and submit</span>
              </button>
            </div>
          </div>

          {/* Submission Success Banner */}
          {submittedPr && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-xs text-emerald-950">
              <div className="flex items-center space-x-2 font-bold text-emerald-800 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Purchase Request Created!</span>
              </div>
              <p>Requisition successfully recorded as <b className="font-mono text-emerald-700">{submittedPr}</b>.</p>
              <p className="mt-1 text-[11px] text-emerald-800">It has been queued for policy evaluation and consolidation.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
