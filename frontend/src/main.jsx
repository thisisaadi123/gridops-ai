import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './LandingPage.jsx';
import { ProgressScreen } from './ProgressScreen.jsx';
import { Dashboard } from './Dashboard.jsx';
import { EventsDatabase } from './EventsDatabase.jsx';
import { DEMO_RESULT } from './demoData.js';
import './styles.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

function App() {
  const [screen, setScreen] = useState('coldstart'); // start with cold-start check
  const [coldStartElapsed, setColdStartElapsed] = useState(0);
  const [coldStartResolved, setColdStartResolved] = useState(false);
  const [threshold, setThreshold] = useState(0.30);
  const [horizon, setHorizon] = useState(7);
  const [targetDate, setTargetDate] = useState('2018-08-03');
  const [health, setHealth] = useState({ api: 'checking', redis: 'checking', celery: 'checking' });
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState({ status: 'IDLE', stage: '', progress: 0, message: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [eventsData, setEventsData] = useState([]);
  const [isDemo, setIsDemo] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`${API}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setHealth({
        api: 'connected',
        redis: d.redis || 'disconnected',
        celery: d.celery || 'disconnected',
      });
      // If we were in cold-start, transition to landing now
      if (!coldStartResolved) {
        setColdStartResolved(true);
        setScreen('landing');
      }
      return true;
    } catch {
      setHealth({ api: 'disconnected', redis: 'disconnected', celery: 'disconnected' });
      return false;
    }
  }, [coldStartResolved]);

  // On first load: check if server is up. If not, show cold-start screen.
  useEffect(() => {
    const initialCheck = async () => {
      const ok = await checkHealth();
      if (!ok) {
        setScreen('coldstart');
      }
    };
    initialCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cold-start: retry health check every 5 seconds + run elapsed timer
  useEffect(() => {
    if (screen !== 'coldstart') return;
    const retryIv = setInterval(checkHealth, 5000);
    const elapsedIv = setInterval(() => setColdStartElapsed(p => p + 1), 1000);
    return () => { clearInterval(retryIv); clearInterval(elapsedIv); };
  }, [screen, checkHealth]);

  // Normal 15-second health refresh once live
  useEffect(() => {
    if (screen === 'coldstart') return;
    const iv = setInterval(checkHealth, 15000);
    return () => clearInterval(iv);
  }, [screen, checkHealth]);

  useEffect(() => {
    if (!taskId || screen !== 'running') return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${API}/status/${taskId}`);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const d = await r.json();
        setProgress(d);
        if (d.status === 'SUCCESS') { setResult(d.result); setScreen('dashboard'); clearInterval(iv); }
        if (d.status === 'FAILURE') { setError(d.error || 'Pipeline failed'); setScreen('landing'); clearInterval(iv); }
      } catch (e) { setError(e.message); }
    }, 1500);
    return () => clearInterval(iv);
  }, [taskId, screen]);

  async function startPipeline() {
    setError(''); setResult(null); setStartedAt(Date.now()); setIsDemo(false);
    setProgress({ status: 'QUEUED', stage: 'DATA_PIPELINE', progress: 0, message: 'Queued' });
    setScreen('running');
    try {
      const r = await fetch(`${API}/orchestrate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_path: 'data_store/pjm_hourly_est.csv',
          severity_threshold: threshold,
          forecast_horizon: horizon,
          target_date: targetDate || null,
        }),
      });
      if (!r.ok) throw new Error(`API returned ${r.status}`);
      const d = await r.json();
      setTaskId(d.task_id);
    } catch (e) { setError(e.message); setScreen('landing'); }
  }

  function loadDemo() {
    setError(''); setResult(DEMO_RESULT); setStartedAt(Date.now() - 42000);
    setIsDemo(true);
    setScreen('dashboard');
  }

  async function fetchEvents() {
    try {
      const r = await fetch(`${API}/events`);
      if (!r.ok) throw new Error('Failed to fetch events');
      const d = await r.json();
      setEventsData(d.events || []);
    } catch (e) { console.error(e); }
  }

  function viewEvents() {
    fetchEvents();
    setScreen('events');
  }

  async function addEvent(eventData) {
    try {
      const r = await fetch(`${API}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      });
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      if (screen === 'events') fetchEvents(); // refresh if currently viewing
      return await r.json();
    } catch (e) { throw e; }
  }

  function exportCSV() {
    if (!result) return;
    const dates = result.forecast_dates || [];
    const rows = [['Date', 'Actual', 'SARIMA', 'Chronos_p50', 'Chronos_p10', 'Chronos_p90']];
    dates.forEach((d, i) => {
      rows.push([
        d,
        (result.holdout_data || [])[i] ?? '',
        (result.sarima_forecast || [])[i] ?? '',
        (result.chronos_p50 || [])[i] ?? '',
        (result.chronos_p10 || [])[i] ?? '',
        (result.chronos_p90 || [])[i] ?? '',
      ].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gridops_forecast.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="shell">
      <Nav 
        screen={screen} 
        health={health}
        onHome={() => setScreen('landing')} 
        onStatus={() => setShowStatusModal(true)}
        onDemo={loadDemo}
        isDemo={isDemo}
        onEvents={viewEvents}
      />
      
      {screen === 'coldstart' && (
        <ColdStartScreen elapsed={coldStartElapsed} />
      )}

      {screen === 'landing' && (
        <LandingPage
          threshold={threshold} setThreshold={setThreshold}
          horizon={horizon} setHorizon={setHorizon}
          targetDate={targetDate} setTargetDate={setTargetDate}
          error={error}
          onStart={startPipeline}
          onAddEvent={addEvent}
        />
      )}
      
      {screen === 'running' && (
        <ProgressScreen progress={progress} startedAt={startedAt} />
      )}
      
      {screen === 'dashboard' && result && (
        <Dashboard 
          result={result} 
          elapsed={startedAt ? Date.now() - startedAt : 0}
          onNew={() => { setResult(null); setScreen('landing'); }}
          onExport={exportCSV} 
          horizon={horizon}
        />
      )}

      {screen === 'events' && (
        <EventsDatabase 
          events={eventsData} 
          onAddEvent={addEvent} 
          onBack={() => setScreen(result ? 'dashboard' : 'landing')} 
        />
      )}

      {showStatusModal && (
        <StatusModal 
          health={health} 
          onClose={() => setShowStatusModal(false)} 
          onRefresh={checkHealth}
        />
      )}
    </div>
  );
}

function Nav({ screen, health, onHome, onStatus, onDemo, isDemo, onEvents }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const allConnected = health.api === 'connected' && health.redis === 'connected' && health.celery === 'connected';
  const anyDisconnected = health.api === 'disconnected' || health.redis === 'disconnected' || health.celery === 'disconnected';

  return (
    <header className={`nav ${isMobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <div className="nav-top-row">
        <button className="nav-brand" onClick={() => { onHome(); setIsMobileMenuOpen(false); }} type="button">
          <span className="accent">Grid</span>Ops AI
        </button>
        <button className="hamburger-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} type="button" aria-label="Toggle Menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </div>
      <div className="nav-right">
        {/* Live Health Indicator */}
        <button className="nav-health-indicator" onClick={() => { onStatus(); setIsMobileMenuOpen(false); }} type="button" title="View system status">
          <HealthDot label="API" status={health.api} />
          <HealthDot label="Redis" status={health.redis} />
          <HealthDot label="Worker" status={health.celery} />
        </button>

        {screen === 'landing' && (
          <button className="btn-secondary compact" onClick={() => { onDemo(); setIsMobileMenuOpen(false); }} type="button">
            Demo Mode
          </button>
        )}
        {(screen === 'dashboard' || screen === 'events') && (
          <button className="btn-secondary compact" onClick={() => { onHome(); setIsMobileMenuOpen(false); }} type="button">
            Back to Setup
          </button>
        )}
        <button className="btn-secondary compact" onClick={() => { onEvents(); setIsMobileMenuOpen(false); }} type="button">
          Event Database
        </button>
      </div>
    </header>
  );
}

function HealthDot({ label, status }) {
  const isOnline = status === 'connected';
  const isChecking = status === 'checking';
  return (
    <div className="health-dot-item" title={`${label}: ${isChecking ? 'Checking...' : isOnline ? 'Online' : 'Offline'}`}>
      <i className={`dot ${isChecking ? 'amber' : isOnline ? 'emerald' : 'coral'}`} />
      <span className="health-dot-label">{label}</span>
    </div>
  );
}

function StatusModal({ health, onClose, onRefresh }) {
  const services = [
    { key: 'api', label: 'FastAPI Core Engine', desc: 'Handles REST requests and serves the frontend API.' },
    { key: 'redis', label: 'Redis Message Broker', desc: 'Queues pipeline tasks and stores results.' },
    { key: 'celery', label: 'Celery Worker', desc: 'Executes the forecasting pipeline and agent reasoning.' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 className="modal-title">System Status</h2>
        
        <div className="status-row">
          {services.map(svc => {
            const status = health[svc.key];
            const isOnline = status === 'connected';
            const isChecking = status === 'checking';
            return (
              <div key={svc.key} className="status-dot-item">
                <i className={`dot ${isChecking ? 'amber' : isOnline ? 'emerald' : 'coral'}`} />
                <div className="status-info">
                  <span className="status-svc-name">{svc.label}</span>
                  <span className="status-svc-desc">{svc.desc}</span>
                </div>
                <strong className={isOnline ? 'status-online' : 'status-offline'}>
                  {isChecking ? 'Checking' : isOnline ? 'Online' : 'Offline'}
                </strong>
              </div>
            );
          })}
        </div>
        

        <button className="btn-secondary" onClick={onRefresh} style={{marginTop: '16px'}}>
          Refresh Now
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

/* ── Cold Start Screen ── */
function ColdStartScreen({ elapsed }) {
  const BOOT_STEPS = [
    { label: 'Starting Docker container',          duration: 15 },
    { label: 'Downloading target grid data', duration: 120 },
    { label: 'Loading Chronos-2 weights',   duration: 90 },
    { label: 'Initializing AutoGluon',     duration: 100 }
  ];

  const loadingMessages = [
    {
      title: "Waking up the AI...",
      text: "The server needs to boot up, load the Chronos-2 AI model into memory, and start"
    }
  ];

  // Figure out which step we're on based on elapsed seconds
  let stepIdx = 0;
  for (let i = 0; i < BOOT_STEPS.length - 1; i++) {
    if (elapsed >= BOOT_STEPS[i].duration) stepIdx = i + 1;
  }

  return (
    <div className="progress-page animation-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 className="loading-title" style={{ fontSize: '30px', marginBottom: '12px' }}>
          Service is warming up...
        </h1>
        <p className="loading-subtitle" style={{ maxWidth: '540px', margin: '0 auto 12px auto' }}>
          This app runs on a free Hugging Face Space. Free spaces go to sleep automatically
          after 48 hours of inactivity to save resources.
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', maxWidth: '480px', margin: '0 auto', lineHeight: 1.6 }}>
          GridOps AI is running on Hugging Face Spaces free-tier hardware.
          The server needs to boot up, load the Chronos-2 AI model into memory, and start
          the background Celery workers. This takes roughly 5 to 7 minutes on a cold start.
          Once warmed up, the service stays live for 48 hours — subsequent visitors see no wait.
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: '500px' }}>
        <div className="spinner" style={{ margin: '0 auto 32px auto' }} />

        {/* Boot steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left', marginBottom: '28px' }}>
          {BOOT_STEPS.map((step, i) => {
            const isDone = i < stepIdx;
            const isActive = i === stepIdx;
            const isPending = i > stepIdx;
            return (
              <div key={step.label} style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '12px 16px', borderRadius: '8px',
                background: isActive ? 'rgba(6,182,212,0.07)' : isDone ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive ? 'rgba(6,182,212,0.2)' : isDone ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 0.4s ease',
              }}>
                <div style={{
                  width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? 'rgba(6,182,212,0.12)' : isDone ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${isActive ? 'var(--accent-cyan)' : isDone ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                }}>
                  {isDone && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <polyline points="1,4.5 3.5,7 8,1.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {isActive && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent-cyan)', boxShadow: '0 0 6px rgba(6,182,212,0.8)' }} />}
                </div>
                <span style={{
                  fontSize: '13px',
                  color: isActive ? 'var(--accent-cyan)' : isDone ? '#10b981' : 'var(--text-tertiary)',
                  fontWeight: isActive || isDone ? 600 : 400,
                }}>
                  {step.label}
                </span>
                {isActive && (
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace" }}>
                    in progress…
                  </span>
                )}
                {isDone && (
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#10b981' }}>Done</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Elapsed timer */}
        <div style={{ fontSize: '22px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--accent-cyan)', fontWeight: 'bold', marginBottom: '6px' }}>
          {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>
          Checking server status every 5 seconds…
        </div>
      </div>
    </div>
  );
}
