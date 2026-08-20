import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Database, Cpu, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface DependencyStatus {
  status: string;
  database: string;
  redis: string;
}

export const Home: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [statusData, setStatusData] = useState<DependencyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<DependencyStatus>('/health/dependencies');
      setStatusData(response.data);
    } catch (err: any) {
      console.error('Error fetching health status:', err);
      setError(err.response?.data?.message || err.message || 'Failed to connect to API server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white px-4">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-700">
        <h1 className="text-3xl font-extrabold text-indigo-400 text-center mb-2">
          ReachInbox Email Scheduler
        </h1>
        <p className="text-slate-400 text-center font-medium text-sm tracking-wide uppercase mb-6">
          Phase 1 Foundation
        </p>

        <div className="space-y-4">
          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800">
            <div className="flex justify-between items-center mb-3">
              <span className="text-slate-400 font-semibold text-xs tracking-wider uppercase">Infrastructure Health</span>
              <button 
                onClick={fetchStatus}
                disabled={loading}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4 text-indigo-400">
                <Loader2 className="animate-spin mr-2 h-5 w-5" />
                <span className="text-sm">Querying system dependencies...</span>
              </div>
            ) : error ? (
              <div className="flex items-start text-red-400 p-3 bg-red-950/30 rounded-lg border border-red-900/50">
                <XCircle className="shrink-0 mr-2 h-5 w-5 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">Backend Unreachable</p>
                  <p className="text-xs text-red-500 mt-1">{error}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* PostgreSQL Connection */}
                <div className="flex items-center justify-between p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
                  <div className="flex items-center">
                    <Database className="h-5 w-5 text-emerald-400 mr-2.5" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">PostgreSQL Database</p>
                      <p className="text-xs text-slate-500">Persists users, campaigns & leads</p>
                    </div>
                  </div>
                  {statusData?.database === 'connected' ? (
                    <span className="flex items-center text-xs font-semibold text-emerald-400 bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/50">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center text-xs font-semibold text-rose-400 bg-rose-950/30 px-2 py-1 rounded border border-rose-900/50">
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Disconnected
                    </span>
                  )}
                </div>

                {/* Redis Connection */}
                <div className="flex items-center justify-between p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
                  <div className="flex items-center">
                    <Cpu className="h-5 w-5 text-indigo-400 mr-2.5" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">Redis Connection</p>
                      <p className="text-xs text-slate-500">Brokers BullMQ job events</p>
                    </div>
                  </div>
                  {statusData?.redis === 'connected' ? (
                    <span className="flex items-center text-xs font-semibold text-emerald-400 bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/50">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Connected
                    </span>
                  ) : (
                    <span className="flex items-center text-xs font-semibold text-rose-400 bg-rose-950/30 px-2 py-1 rounded border border-rose-900/50">
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Disconnected
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            Ensure your local Docker containers are running before verifying connections.
          </p>
        </div>
      </div>
    </div>
  );
};
