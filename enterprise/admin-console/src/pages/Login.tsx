import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, LogIn } from 'lucide-react';
import ClawForgeLogo from '../components/ClawForgeLogo';

export default function Login() {
  const { loginWithMicrosoft, loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  const handleMicrosoftLogin = async () => {
    setMsLoading(true);
    setError('');
    try {
      await loginWithMicrosoft();
    } catch (e: any) {
      setError(e.message || 'Microsoft sign-in failed');
      setMsLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!empId || !password) return;
    setLoading(true);
    setError('');
    try {
      await loginWithPassword(empId, password);
      const saved = localStorage.getItem('openclaw_token');
      if (saved) {
        const payload = JSON.parse(atob(saved.split('.')[1]));
        if (payload.mustChangePassword) navigate('/change-password');
        else if (payload.role === 'employee') navigate('/portal');
        else navigate('/dashboard');
      }
    } catch (e: any) {
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex mb-4"><ClawForgeLogo size={56} animate="idle" /></div>
          <h1 className="text-2xl font-bold text-text-primary">OpenClaw Enterprise</h1>
          <p className="text-sm text-text-muted mt-1">on AgentCore - aws-samples</p>
        </div>

        {/* Sign In Card */}
        <div className="rounded-xl border border-dark-border bg-dark-card p-6 mb-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Sign In</h2>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 mb-4">
              <AlertCircle size={16} className="text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Microsoft Login */}
          <button
            onClick={handleMicrosoftLogin}
            disabled={msLoading}
            className="w-full flex items-center justify-center gap-3 rounded-lg bg-[#0078d4] px-4 py-3 text-sm font-medium text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            {msLoading ? 'Redirecting...' : 'Sign in with Microsoft'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-dark-border" />
            <span className="text-xs text-text-muted">or sign in with password</span>
            <div className="flex-1 h-px bg-dark-border" />
          </div>

          {/* Password Login */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Employee ID</label>
              <input
                type="text" value={empId} onChange={e => setEmpId(e.target.value)}
                placeholder="emp-jiade or EMP-030"
                className="w-full rounded-lg border border-dark-border bg-dark-bg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && empId && password && handlePasswordLogin()}
                placeholder="Enter password"
                className="w-full rounded-lg border border-dark-border bg-dark-bg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
              />
            </div>
            <button
              onClick={handlePasswordLogin}
              disabled={!empId || !password || loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <LogIn size={16} /> {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </div>

        {/* Contributor */}
        <div className="text-center mt-6">
          <p className="text-xs text-text-muted">
            Built by <a href="mailto:wjiad@amazon.com" className="text-primary-light hover:underline">wjiad@aws</a> - Contributions welcome
          </p>
        </div>
      </div>
    </div>
  );
}
