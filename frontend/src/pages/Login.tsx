import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail } from 'lucide-react';

export const Login: React.FC = () => {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white px-4">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl p-8 border border-slate-700 text-center">
        <div className="inline-flex items-center justify-center bg-indigo-500/10 text-indigo-400 p-4 rounded-full mb-6">
          <Mail className="h-10 w-10" />
        </div>
        
        <h1 className="text-3xl font-extrabold text-indigo-400 mb-2">
          ReachInbox Email Scheduler
        </h1>
        
        <p className="text-slate-300 font-medium text-sm mb-8">
          Schedule and manage your emails reliably.
        </p>

        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 hover:bg-slate-100 font-bold py-3.5 px-6 rounded-xl transition duration-200 shadow-md hover:shadow-lg"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
            <g transform="matrix(1, 0, 0, 1, 0, 0)">
              <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.04,3.1v2.57h3.3c1.93,-1.78 3.04,-4.4 3.04,-7.47c0,-0.61 -0.05,-1.2 -0.16,-1.73z" fill="#4285F4" />
              <path d="M12,20.6c2.43,0 4.47,-0.8 5.96,-2.18l-3.3,-2.57c-0.91,0.61 -2.08,0.98 -3.3,0.98c-2.34,0 -4.32,-1.58 -5.03,-3.7H3.3l-2.43,1.87C2.08,17.47 6.69,20.6 12,20.6z" fill="#34A853" />
              <path d="M6.97,13.13a6.1,6.1 0 0 1 0,-3.72V5.7H3.3a10.02,10.02 0 0 0 0,9.3l3.67,-2.87z" fill="#FBBC05" />
              <path d="M12,7.2c1.32,0 2.5,0.45 3.44,1.35l2.58,-2.58C16.46,4.52 14.43,4 12,4c-5.31,0 -9.92,3.13 -11.13,7.69l3.67,2.87c0.71,-2.12 2.69,-3.7 5.03,-3.7z" fill="#EA4335" />
            </g>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
};
