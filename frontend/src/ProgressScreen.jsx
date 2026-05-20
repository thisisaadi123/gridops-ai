import React, { useState, useEffect } from 'react';

export function ProgressScreen({ progress }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isDataPipeline = progress.stage === 'DATA_PIPELINE';
  const isChronos = progress.stage === 'CHRONOS_INFERENCE';
  const isAgent = progress.stage === 'AGENT_REASONING';

  const phases = [
    { key: 'data', label: 'Data Validation & SARIMA', active: isDataPipeline },
    { key: 'chronos', label: 'Deep Learning Inference', active: isChronos },
    { key: 'agent', label: 'Agent Reasoning & RAG', active: isAgent },
  ];
  
  return (
    <div className="progress-page animation-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div className="progress-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
        <h1 className="loading-title" style={{ fontSize: '32px', marginBottom: '16px' }}>Executing GridOps AI Pipeline</h1>
        <p className="loading-subtitle" style={{ maxWidth: '500px', margin: '0 auto' }}>
          The system is running inference on the historical dataset and passing the probabilistic 
          outputs to the LangGraph reasoning engine.
        </p>
      </div>

      <div className="spinner-container" style={{ minHeight: 'auto', padding: '40px 0' }}>
        <div className="spinner" style={{ margin: '0 auto 24px auto' }}></div>
        
        {/* Phase indicator pills */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {phases.map((phase, i) => (
            <div key={phase.key} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 16px',
              borderRadius: '9999px',
              background: phase.active ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${phase.active ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255,255,255,0.08)'}`,
              transition: 'all 0.3s',
            }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: phase.active ? 'var(--accent-cyan)' : 'var(--text-tertiary)',
                boxShadow: phase.active ? '0 0 8px rgba(6, 182, 212, 0.5)' : 'none',
              }} />
              <span style={{
                fontSize: '12px', fontWeight: 600,
                color: phase.active ? 'var(--accent-cyan)' : 'var(--text-tertiary)',
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                Phase {i + 1}: {phase.label}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          {progress.message || 'Initializing pipeline...'}
        </div>

        <div style={{ fontSize: '18px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--accent-cyan)', marginBottom: '32px', fontWeight: 'bold' }}>
          {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>

        <div className="loading-warning" style={{ display: 'inline-block' }}>
          Phase 1 (Data Validation & SARIMA Training) typically takes 25-30 seconds.
        </div>
      </div>
    </div>
  );
}
