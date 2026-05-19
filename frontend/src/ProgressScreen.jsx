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
  
  return (
    <div className="progress-page animation-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div className="progress-hero" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
        <h1 className="loading-title" style={{ fontSize: '32px', marginBottom: '16px' }}>Executing GridOps AI Pipeline</h1>
        <p className="loading-subtitle" style={{ maxWidth: '500px', margin: '0 auto' }}>
          The system is currently running inference on the historical dataset and passing the probabilistic 
          outputs to the LangGraph reasoning engine.
        </p>
      </div>

      <div className="spinner-container" style={{ minHeight: 'auto', padding: '40px 0' }}>
        <div className="spinner" style={{ margin: '0 auto 24px auto' }}></div>
        
        <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
          {isDataPipeline ? 'Phase 1: Validating Data & Training SARIMA Baseline...' : 
           isChronos ? 'Phase 2: Generating Deep Learning Forecast (Amazon Chronos)...' : 
           isAgent ? 'Phase 3: LangGraph Agent Reasoning & RAG Retrieval...' : 'Initializing...'}
        </div>
        
        <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
          {progress.message || 'Please wait...'}
        </div>

        <div style={{ fontSize: '18px', fontFamily: '"JetBrains Mono", monospace', color: 'var(--accent-cyan)', marginBottom: '32px', fontWeight: 'bold' }}>
          Time Elapsed: {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>

        <div className="loading-warning" style={{ display: 'inline-block' }}>
          <strong>Note:</strong> Phase 1 (Data Validation & SARIMA Training) is computationally intensive and takes ~25-30 seconds.
        </div>
      </div>
    </div>
  );
}
