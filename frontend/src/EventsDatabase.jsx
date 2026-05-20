import React, { useState, useMemo } from 'react';

const RANDOM_EVENTS = [
  { event_type: "Texas Deep Freeze (Uri Pattern)", severity: "CRITICAL", description: "Unprecedented multi-day freezing temperatures causing severe grid strain and widespread generation failure.", demand_impact_pct: 25.4, grid_region: "PJM-South" },
  { event_type: "Summer Heatwave (Derecho)", severity: "HIGH", description: "Prolonged 100F+ temperatures across the midwest causing massive A/C load and transmission line sagging.", demand_impact_pct: 18.2, grid_region: "PJM-West" },
  { event_type: "Shoulder Month Cold Snap", severity: "MEDIUM", description: "Unexpected cold front during typical shoulder months causing unforecasted heating demand.", demand_impact_pct: 8.5, grid_region: "PJM-East" },
  { event_type: "Major Transmission Outage", severity: "HIGH", description: "Failure of critical 500kV interconnect causing localized demand spikes and rerouting.", demand_impact_pct: 12.0, grid_region: "PJM-West" },
  { event_type: "Industrial Shutdown", severity: "LOW", description: "Planned maintenance of major manufacturing hubs causing sudden drop in base load.", demand_impact_pct: -5.5, grid_region: "PJM-East" }
];

const SEVERITY_LEVELS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const SEVERITY_COLORS = {
  CRITICAL: 'var(--accent-rose)',
  HIGH: '#f97316',
  MEDIUM: 'var(--accent-amber)',
  LOW: 'var(--accent-emerald)',
};

export function EventsDatabase({ events, onAddEvent, onBack }) {
  const [form, setForm] = useState({ event_type: '', severity: 'MEDIUM', description: '', demand_impact_pct: 0, grid_region: 'PJM-West' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchText, setSearchText] = useState('');

  // Count events per severity
  const severityCounts = useMemo(() => {
    const counts = { ALL: events.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    events.forEach(ev => {
      const sev = (ev.severity || '').toUpperCase();
      if (counts[sev] !== undefined) counts[sev]++;
    });
    return counts;
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    let filtered = events;
    
    // Severity filter
    if (activeFilter !== 'ALL') {
      filtered = filtered.filter(ev => (ev.severity || '').toUpperCase() === activeFilter);
    }
    
    // Text search
    if (searchText.trim()) {
      const query = searchText.toLowerCase();
      filtered = filtered.filter(ev =>
        (ev.event_type || '').toLowerCase().includes(query) ||
        (ev.description || '').toLowerCase().includes(query) ||
        (ev.grid_region || '').toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [events, activeFilter, searchText]);

  function autofill() {
    const random = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    setForm(random);
    setMsg('Autofilled random scenario.');
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.event_type || !form.description) return;
    setLoading(true); setMsg('');
    try {
      const res = await onAddEvent(form);
      setMsg(res.message || 'Event embedded and added to Vector DB successfully.');
      setForm({ event_type: '', severity: 'MEDIUM', description: '', demand_impact_pct: 0, grid_region: 'PJM-West' });
    } catch (err) { setMsg('Failed: ' + err.message); }
    setLoading(false);
  }

  return (
    <div className="landing animation-fade-in" style={{ alignItems: 'flex-start' }}>
      <div className="dash-header" style={{ width: '100%', marginBottom: '24px' }}>
        <div>
          <h1>Historical Event Database</h1>
          <p className="muted-text">Manage the ChromaDB vector store used by the Retrieval-Augmented Generation (RAG) node.</p>
        </div>
        <button className="btn-secondary compact" onClick={onBack}>← Back</button>
      </div>

      <div className="config-grid" style={{ width: '100%' }}>
        <div className="glass-card">
          <div className="step-header" style={{ textAlign: 'left', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', marginBottom: '8px' }}>Inject Custom Scenario (Optional)</h2>
            <p>Embed new historical or hypothetical grid events into the database. The RAG agent will query these events if future anomalies match their pattern.</p>
          </div>

          <form className="event-form" onSubmit={submit}>
            <div className="field-group" style={{ marginBottom: '16px' }}>
              <label className="field-label">Event Name</label>
              <input className="field-input" placeholder="e.g. Texas Deep Freeze"
                value={form.event_type} onChange={e => setForm({ ...form, event_type: e.target.value })} required />
            </div>
            
            <div className="form-row" style={{ marginBottom: '16px' }}>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label className="field-label">Severity Level</label>
                <select className="field-input" value={form.severity}
                  onChange={e => setForm({ ...form, severity: e.target.value })}>
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
                </select>
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label className="field-label">Demand Impact (%)</label>
                <input type="number" className="field-input" step="0.1"
                  value={form.demand_impact_pct} onChange={e => setForm({ ...form, demand_impact_pct: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>

            <div className="field-group" style={{ marginBottom: '16px' }}>
              <label className="field-label">Grid Region</label>
              <select className="field-input" value={form.grid_region}
                onChange={e => setForm({ ...form, grid_region: e.target.value })}>
                <option>PJM-West</option><option>PJM-East</option><option>PJM-South</option><option>PJM-System</option>
              </select>
            </div>
            
            <div className="field-group" style={{ marginBottom: '24px' }}>
              <label className="field-label">Contextual Description</label>
              <textarea className="field-input" rows={3} placeholder="Describe the weather or grid conditions..."
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required />
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-secondary" type="button" onClick={autofill} style={{ flex: 1 }}>
                Random Autofill
              </button>
              <button className="btn-primary" type="submit" disabled={loading} style={{ flex: 2, padding: '14px' }}>
                {loading ? 'Embedding...' : 'Inject into Vector DB'}
              </button>
            </div>
            
            {msg && <div className="event-msg">{msg}</div>}
          </form>
        </div>

        <div className="glass-card" style={{ maxHeight: '800px', overflowY: 'auto' }}>
          <h2 style={{ fontSize: '20px', marginBottom: '16px', color: 'var(--text-primary)' }}>Vector DB Contents</h2>
          
          {/* Search Input */}
          <div className="events-search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input 
              className="events-search-input"
              type="text"
              placeholder="Search events by name, description, or region..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            {searchText && (
              <button className="events-search-clear" onClick={() => setSearchText('')} type="button">×</button>
            )}
          </div>

          {/* Severity Filter Pills */}
          <div className="filter-bar">
            {SEVERITY_LEVELS.map(level => {
              const isActive = activeFilter === level;
              const count = severityCounts[level] || 0;
              const color = level === 'ALL' ? 'var(--accent-cyan)' : SEVERITY_COLORS[level];
              return (
                <button
                  key={level}
                  className={`filter-pill ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveFilter(level)}
                  type="button"
                  style={isActive ? { 
                    borderColor: color, 
                    background: `${color}15`,
                    color: color,
                  } : {}}
                >
                  {level}
                  <span className="filter-pill-count" style={isActive ? { background: color, color: '#000' } : {}}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          
          {filteredEvents.length === 0 ? (
            <div className="empty-msg">
              {events.length === 0 
                ? 'No events found in the database.' 
                : `No events match the current filter${searchText ? ` "${searchText}"` : ''}.`
              }
              {activeFilter !== 'ALL' && events.length > 0 && (
                <button 
                  className="link-btn" 
                  onClick={() => { setActiveFilter('ALL'); setSearchText(''); }}
                  style={{ marginTop: '12px', display: 'block' }}
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="event-list">
              <div className="events-result-count">
                Showing {filteredEvents.length} of {events.length} events
              </div>
              {filteredEvents.map((ev, i) => {
                const sevClass = `sev-${(ev.severity || 'medium').toLowerCase()}`;
                return (
                  <div key={i} className="event-card">
                    <div className="event-header">
                      <strong>{ev.event_type}</strong>
                      <span className={`sev ${sevClass}`}>{ev.severity}</span>
                      <span className="impact">{ev.demand_impact_pct > 0 ? '+' : ''}{ev.demand_impact_pct}% | {ev.grid_region}</span>
                    </div>
                    <p>{ev.description}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
