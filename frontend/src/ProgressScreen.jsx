import React, { useState, useEffect } from 'react';

const STAGE_INFO = {
  DATA_PIPELINE: {
    label: 'Data Pipeline',
    description:
      'Loading 16 years of PJM hourly energy readings, scanning for gaps and outliers, ' +
      'then fitting a SARIMA statistical model to establish a classical baseline forecast.',
    estimatedSeconds: '15 – 25s',
  },
  CHRONOS_INFERENCE: {
    label: 'Chronos Inference',
    description:
      'Running the Amazon Chronos-2 Multivariate model via PyTorch ' +
      'and performing multi-step inferencing to generate probabilistic forecasts with p10 / p50 / p90 confidence intervals.',
    estimatedSeconds: '10 – 20s',
  },
  AGENT_REASONING: {
    label: 'LangGraph Agent',
    description:
      'Executing the 7-node LangGraph pipeline: divergence analysis, seasonality detection, ' +
      'RAG retrieval from the event database, VaR quantification, and mandate synthesis.',
    estimatedSeconds: '10 – 15s',
  },
};

const PHASE_ORDER = ['DATA_PIPELINE', 'CHRONOS_INFERENCE', 'AGENT_REASONING'];

export function ProgressScreen({ progress }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentStage = progress.stage || 'DATA_PIPELINE';
  const currentPct = progress.progress || 0;
  const currentInfo = STAGE_INFO[currentStage] || STAGE_INFO.DATA_PIPELINE;
  const currentPhaseIdx = PHASE_ORDER.indexOf(currentStage);

  return (
    <div className="progress-page animation-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div className="progress-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
        <h1 className="loading-title" style={{ fontSize: '32px', marginBottom: '12px' }}>
          Executing GridOps AI Pipeline
        </h1>
        <p className="loading-subtitle" style={{ maxWidth: '520px', margin: '0 auto' }}>
          {currentInfo.description}
        </p>
        <div style={{ marginTop: '12px', fontSize: '14px', color: 'var(--accent-amber)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
          ETA: 1.5 – 2.5 minutes
        </div>
      </div>

      <div className="spinner-container" style={{ minHeight: 'auto', padding: '0 0 40px 0', width: '100%', maxWidth: '560px' }}>
        <div className="spinner" style={{ margin: '0 auto 32px auto' }} />

        {/* Step progress */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px', textAlign: 'left' }}>
          {PHASE_ORDER.map((key, i) => {
            const info = STAGE_INFO[key];
            const isDone = i < currentPhaseIdx;
            const isActive = i === currentPhaseIdx;
            const isPending = i > currentPhaseIdx;

            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'flex-start', gap: '14px',
                padding: '14px 18px',
                borderRadius: '10px',
                background: isActive
                  ? 'rgba(6, 182, 212, 0.08)'
                  : isDone
                    ? 'rgba(16, 185, 129, 0.06)'
                    : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive
                  ? 'rgba(6, 182, 212, 0.25)'
                  : isDone
                    ? 'rgba(16, 185, 129, 0.2)'
                    : 'rgba(255,255,255,0.06)'}`,
                transition: 'all 0.4s ease',
              }}>
                {/* Status dot */}
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive
                    ? 'rgba(6, 182, 212, 0.15)'
                    : isDone
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${isActive ? 'var(--accent-cyan)' : isDone ? '#10b981' : 'rgba(255,255,255,0.12)'}`,
                }}>
                  {isDone && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <polyline points="1.5,5 4,7.5 8.5,2" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isActive && (
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-cyan)', boxShadow: '0 0 6px rgba(6,182,212,0.8)' }} />
                  )}
                </div>

                {/* Text */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                    <span style={{
                      fontSize: '13px', fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      color: isActive ? 'var(--accent-cyan)' : isDone ? '#10b981' : 'var(--text-tertiary)',
                    }}>
                      {info.label}
                    </span>
                    {isActive && (
                      <span style={{ fontSize: '11px', color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPct}%
                      </span>
                    )}
                    {isDone && (
                      <span style={{ fontSize: '11px', color: '#10b981' }}>Complete</span>
                    )}
                    {isPending && (
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{info.estimatedSeconds}</span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: isActive ? 'var(--text-secondary)' : 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    {info.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '16px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${currentPct}%`,
            background: 'linear-gradient(90deg, rgba(6,182,212,0.8), var(--accent-cyan))',
            borderRadius: '2px',
            transition: 'width 0.6s ease',
            boxShadow: '0 0 8px rgba(6,182,212,0.4)',
          }} />
        </div>

        {/* Elapsed timer */}
        <div style={{ fontSize: '18px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
          {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '6px' }}>
          {progress.message || 'Initializing pipeline…'}
        </div>
      </div>
    </div>
  );
}
