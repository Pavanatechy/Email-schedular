import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { emailService } from '../services/email.service';
import { useToast } from '../context/ToastContext';
import { Email, Pagination } from '../types';
import { 
  Clock, 
  Send, 
  RefreshCw, 
  XOctagon, 
  AlertCircle, 
  Info, 
  ExternalLink,
  ChevronLeft, 
  ChevronRight,
  Inbox,
  Plus
} from 'lucide-react';

type Tab = 'scheduled' | 'sent';

export const Dashboard: React.FC = () => {
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [emails, setEmails] = useState<Email[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, pages: 1, page: 1, limit: 10 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view Modal
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // holds emailId during async action

  const fetchEmails = useCallback(async (tab: Tab, pageNum = 1) => {
    try {
      setLoading(true);
      setError(null);
      const res = tab === 'scheduled'
        ? await emailService.getScheduledEmails(pageNum, 10)
        : await emailService.getSentEmails(pageNum, 10);
      
      if (res.success && res.data) {
        setEmails((res.data as any).data || []);
        if (res.pagination) {
          setPagination(res.pagination);
        }
      } else {
        setError(res.message || 'Failed to fetch emails');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.message || 'Unable to retrieve emails. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails(activeTab, 1);
  }, [activeTab, fetchEmails]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    fetchEmails(activeTab, newPage);
  };

  const handleCancelEmail = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // prevent modal trigger
    try {
      setActionLoading(id);
      const res = await emailService.cancelEmail(id);
      if (res.success) {
        addToast(res.message || 'Email cancelled successfully', 'success');
        // Refresh active list
        fetchEmails(activeTab, pagination.page);
      } else {
        addToast(res.message || 'Failed to cancel email', 'error');
      }
    } catch (err: any) {
      addToast(err.response?.data?.message || 'Failed to cancel email', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryEmail = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // prevent modal trigger
    try {
      setActionLoading(id);
      const res = await emailService.retryEmail(id);
      if (res.success) {
        addToast('Email retry scheduled successfully', 'success');
        // Refresh active list
        fetchEmails(activeTab, pagination.page);
      } else {
        addToast(res.message || 'Failed to retry email', 'error');
      }
    } catch (err: any) {
      addToast(err.response?.data?.message || 'Failed to retry email', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatLocalTime = (utcStr: string) => {
    return new Date(utcStr).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
            <Clock className="h-3.5 w-3.5" />
            SCHEDULED
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800 animate-pulse">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            PROCESSING
          </span>
        );
      case 'SENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
            <Send className="h-3.5 w-3.5" />
            SENT
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-800">
            <AlertCircle className="h-3.5 w-3.5" />
            FAILED
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XOctagon className="h-3.5 w-3.5" />
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-16 md:pb-0">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Email Scheduler</h1>
          <p className="text-sm text-slate-400 mt-1">Manage and track your distributed email campaigns.</p>
        </div>
        <button
          onClick={() => navigate('/compose')}
          className="flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 px-5 rounded-xl transition duration-200 shadow-md hover:shadow-indigo-500/20"
        >
          <Plus className="h-5 w-5" />
          Compose New Email
        </button>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('scheduled')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-sm transition focus:outline-none ${
            activeTab === 'scheduled'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="h-4 w-4" />
          Scheduled Emails
        </button>
        <button
          onClick={() => setActiveTab('sent')}
          className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-sm transition focus:outline-none ${
            activeTab === 'sent'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Send className="h-4 w-4" />
          Sent & Failed Emails
        </button>
      </div>

      {/* Table Data Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        {loading ? (
          /* Loading Skeletons */
          <div className="p-6 space-y-4">
            <div className="h-5 bg-slate-800 rounded-lg w-1/4 animate-pulse" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="grid grid-cols-4 gap-4 py-3 border-b border-slate-800/50">
                  <div className="h-4 bg-slate-800 rounded animate-pulse" />
                  <div className="h-4 bg-slate-800 rounded animate-pulse col-span-2" />
                  <div className="h-4 bg-slate-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          /* Error State */
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <div className="bg-rose-500/10 text-rose-400 p-4 rounded-full mb-4">
              <AlertCircle className="h-8 w-8" />
            </div>
            <p className="text-slate-200 font-bold mb-2">{error}</p>
            <button
              onClick={() => fetchEmails(activeTab, pagination.page)}
              className="mt-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold py-2 px-4 rounded-xl border border-slate-700 transition"
            >
              Try Again
            </button>
          </div>
        ) : emails.length === 0 ? (
          /* Empty State */
          <div className="p-16 text-center flex flex-col items-center justify-center">
            <div className="bg-slate-950 text-slate-600 p-5 rounded-full mb-4">
              <Inbox className="h-10 w-10" />
            </div>
            <p className="text-slate-300 font-bold text-lg mb-1">
              {activeTab === 'scheduled' ? 'No scheduled emails' : 'No sent emails yet'}
            </p>
            <p className="text-slate-500 text-sm max-w-sm mb-6">
              {activeTab === 'scheduled'
                ? "You haven't scheduled any emails yet. Get started by composing a new message."
                : "You haven't dispatched any campaigns yet."}
            </p>
            {activeTab === 'scheduled' && (
              <button
                onClick={() => navigate('/compose')}
                className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 px-5 rounded-xl transition duration-200 shadow-md"
              >
                Compose New Email
              </button>
            )}
          </div>
        ) : (
          /* Table Output */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/50 border-b border-slate-800 text-slate-400 font-semibold text-xs uppercase tracking-wider">
                  <th className="px-6 py-4">Recipient</th>
                  <th className="px-6 py-4">Subject</th>
                  <th className="px-6 py-4">
                    {activeTab === 'scheduled' ? 'Scheduled Time' : 'Processed Time'}
                  </th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {emails.map((email) => (
                  <tr
                    key={email.id}
                    onClick={() => setSelectedEmail(email)}
                    className="hover:bg-slate-800/40 cursor-pointer transition duration-150"
                  >
                    <td className="px-6 py-4 text-sm font-semibold text-slate-200 max-w-[200px] truncate">
                      {email.recipient}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300 max-w-[300px] truncate">
                      {email.subject}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400 whitespace-nowrap">
                      {formatLocalTime(activeTab === 'scheduled' ? email.scheduledAt : (email.sentAt || email.updatedAt))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(email.status)}
                    </td>
                    <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {activeTab === 'scheduled' && email.status === 'SCHEDULED' && (
                        <button
                          onClick={(e) => handleCancelEmail(e, email.id)}
                          disabled={actionLoading === email.id}
                          className="text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg border border-rose-500/20 transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                      {activeTab === 'sent' && email.status === 'FAILED' && (
                        <button
                          onClick={(e) => handleRetryEmail(e, email.id)}
                          disabled={actionLoading === email.id}
                          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg border border-indigo-500/20 transition disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {!loading && !error && emails.length > 0 && (
          <div className="bg-slate-950/40 border-t border-slate-800 px-6 py-4 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500 font-medium">
              Total: {pagination.total} logs
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="flex items-center justify-center p-2 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition disabled:opacity-30 border border-slate-850"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-300 px-2">
                Page {pagination.page} of {pagination.pages}
              </span>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="flex items-center justify-center p-2 rounded-lg bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition disabled:opacity-30 border border-slate-850"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details View Modal popup */}
      {selectedEmail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-slate-950/60 px-6 py-4 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-white">Email Log Details</h3>
                <p className="text-xs text-slate-400 mt-0.5">ID: {selectedEmail.id}</p>
              </div>
              <button
                onClick={() => setSelectedEmail(null)}
                className="text-slate-400 hover:text-white text-sm font-bold bg-slate-800 hover:bg-slate-750 px-3 py-1.5 rounded-lg border border-slate-700 transition"
              >
                Close
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-slate-500 font-bold block">RECIPIENT</span>
                  <span className="text-slate-200 font-semibold">{selectedEmail.recipient}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-bold block">STATUS</span>
                  <span className="mt-1 block">{getStatusBadge(selectedEmail.status)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-bold block">SCHEDULED TIME</span>
                  <span className="text-slate-300">{formatLocalTime(selectedEmail.scheduledAt)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-bold block">PROCESSED TIME</span>
                  <span className="text-slate-300">
                    {selectedEmail.sentAt ? formatLocalTime(selectedEmail.sentAt) : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-bold block">ATTEMPTS EXPENDED</span>
                  <span className="text-slate-300 font-mono">{selectedEmail.attempts}</span>
                </div>
                {selectedEmail.originalScheduledAt && (
                  <div>
                    <span className="text-xs text-slate-500 font-bold block">ORIGINAL SCHEDULED TIME</span>
                    <span className="text-slate-450">{formatLocalTime(selectedEmail.originalScheduledAt)}</span>
                  </div>
                )}
              </div>

              {/* Error messages block */}
              {selectedEmail.status === 'FAILED' && selectedEmail.errorMessage && (
                <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-4 text-rose-300 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-rose-400" />
                  <div>
                    <span className="font-bold text-xs block text-rose-400 uppercase tracking-wide">Error Traceback</span>
                    <p className="text-sm mt-1">{selectedEmail.errorMessage}</p>
                  </div>
                </div>
              )}

              {/* Ethereal web link */}
              {selectedEmail.status === 'SENT' && selectedEmail.previewUrl && (
                <div className="bg-indigo-950/30 border border-indigo-900/50 rounded-xl p-4 text-indigo-300 flex items-start gap-3">
                  <Info className="h-5 w-5 shrink-0 mt-0.5 text-indigo-400" />
                  <div>
                    <span className="font-bold text-xs block text-indigo-400 uppercase tracking-wide">Ethereal SMTP Dispatch Preview</span>
                    <a
                      href={selectedEmail.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-400 hover:text-indigo-300 underline mt-1.5 transition"
                    >
                      View Live Sent Message
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-800/80 pt-4 space-y-3">
                <div>
                  <span className="text-xs text-slate-500 font-bold block">SUBJECT</span>
                  <p className="text-white font-bold text-base mt-0.5">{selectedEmail.subject}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-bold block">EMAIL BODY</span>
                  <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/80 font-mono text-xs whitespace-pre-wrap max-h-56 overflow-y-auto text-slate-300 mt-1">
                    {selectedEmail.body}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer actions */}
            <div className="bg-slate-950/60 px-6 py-4 border-t border-slate-800 flex justify-end gap-3">
              {selectedEmail.status === 'SCHEDULED' && (
                <button
                  onClick={async (e) => {
                    await handleCancelEmail(e, selectedEmail.id);
                    setSelectedEmail(null);
                  }}
                  disabled={actionLoading === selectedEmail.id}
                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold text-sm py-2 px-4 rounded-xl border border-rose-500/20 transition disabled:opacity-50"
                >
                  Cancel Scheduled Email
                </button>
              )}
              {selectedEmail.status === 'FAILED' && (
                <button
                  onClick={async (e) => {
                    await handleRetryEmail(e, selectedEmail.id);
                    setSelectedEmail(null);
                  }}
                  disabled={actionLoading === selectedEmail.id}
                  className="bg-indigo-500 hover:bg-indigo-650 text-white font-bold text-sm py-2 px-4 rounded-xl transition disabled:opacity-50"
                >
                  Retry Dispatch
                </button>
              )}
              <button
                onClick={() => setSelectedEmail(null)}
                className="bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-sm py-2 px-4 rounded-xl border border-slate-700 transition"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
