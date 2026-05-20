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
  const [screen, setScreen] = useState('landing');
  const [threshold, setThreshold] = useState(0.40);
  const [horizon, setHorizon] = useState(30);
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
      const r = await fetch(`${API}/health`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setHealth({
        api: 'connected',
        redis: d.redis || 'disconnected',
        celery: d.celery || 'disconnected',
      });
    } catch {
      setHealth({ api: 'disconnected', redis: 'disconnected', celery: 'disconnected' });
    }
  }, []);

  // Initial health check + auto-refresh every 15s
  useEffect(() => {
    checkHealth();
    const iv = setInterval(checkHealth, 15000);
    return () => clearInterval(iv);
  }, [checkHealth]);

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
      
      {screen === 'landing' && (
        <LandingPage
          threshold={threshold} setThreshold={setThreshold}
          horizon={horizon} setHorizon={setHorizon}
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
        
        <p className="status-refresh-note">Status auto-refreshes every 15 seconds.</p>
        <button className="btn-secondary" onClick={onRefresh} style={{marginTop: '16px'}}>
          Refresh Now
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
