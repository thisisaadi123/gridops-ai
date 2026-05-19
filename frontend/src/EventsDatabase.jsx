import React, { useState } from 'react';

const RANDOM_EVENTS = [
  { event_type: "Texas Deep Freeze (Uri Pattern)", severity: "CRITICAL", description: "Unprecedented multi-day freezing temperatures causing severe grid strain and widespread generation failure.", demand_impact_pct: 25.4, grid_region: "PJM-South" },
  { event_type: "Summer Heatwave (Derecho)", severity: "HIGH", description: "Prolonged 100F+ temperatures across the midwest causing massive A/C load and transmission line sagging.", demand_impact_pct: 18.2, grid_region: "PJM-West" },
  { event_type: "Shoulder Month Cold Snap", severity: "MEDIUM", description: "Unexpected cold front during typical shoulder months causing unforecasted heating demand.", demand_impact_pct: 8.5, grid_region: "PJM-East" },
  { event_type: "Major Transmission Outage", severity: "HIGH", description: "Failure of critical 500kV interconnect causing localized demand spikes and rerouting.", demand_impact_pct: 12.0, grid_region: "PJM-West" },
  { event_type: "Industrial Shutdown", severity: "LOW", description: "Planned maintenance of major manufacturing hubs causing sudden drop in base load.", demand_impact_pct: -5.5, grid_region: "PJM-East" }
];

export function EventsDatabase({ events, onAddEvent, onBack }) {
  const [form, setForm] = useState({ event_type: '', severity: 'MEDIUM', description: '', demand_impact_pct: 0, grid_region: 'PJM-West' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

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
          <h2 style={{ fontSize: '20px', marginBottom: '24px', color: 'var(--text-primary)' }}>Vector DB Contents</h2>
          
          {events.length === 0 ? (
            <div className="empty-msg">No events found in the database.</div>
          ) : (
            <div className="event-list">
              {events.map((ev, i) => {
                const sevClass = `sev-${ev.severity.toLowerCase()}`;
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
