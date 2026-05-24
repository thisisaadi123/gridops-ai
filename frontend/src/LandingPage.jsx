import React, { useState } from 'react';

export function LandingPage({
  threshold, setThreshold, horizon, setHorizon, error, onStart
}) {
  const [step, setStep] = useState(1);
  const totalSteps = 4;

  const nextStep = () => setStep(s => Math.min(s + 1, totalSteps));
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  return (
    <div className="landing">
      {/* Hero section */}
      <section className="compact-hero">
        <h1>Predict demand. Quantify risk.</h1>
        <p className="subtitle">
          GridOps AI is a multi-agent system that evaluates classical statistical models against deep learning foundation models. 
          It mathematically measures their divergence to detect grid anomalies, retrieves historical context, 
          and generates actionable trading mandates.
        </p>
      </section>

      {/* Stepper Navigation */}
      <div className="stepper-nav">
        {[
          { num: 1, label: "Configuration" },
          { num: 2, label: "Dual-Model Architecture" },
          { num: 3, label: "Graph Execution" },
          { num: 4, label: "Intelligence Engine" }
        ].map(item => (
          <div 
            key={item.num} 
            className={`step-item ${step === item.num ? 'active' : ''} ${step > item.num ? 'completed' : ''}`}
            onClick={() => setStep(item.num)}
          >
            <div className="step-label">Step {item.num}: {item.label}</div>
            <button className="step-dot" aria-label={`Go to step ${item.num}`} />
          </div>
        ))}
      </div>

      <div className="walkthrough-container">
        <div className="walkthrough-content">
          {step === 1 && (
            <Step1Config 
              threshold={threshold} setThreshold={setThreshold}
              horizon={horizon} setHorizon={setHorizon}
              error={error}
            />
          )}
          {step === 2 && <Step2Models />}
          {step === 3 && <Step3Pipeline />}
          {step === 4 && <Step4Intelligence />}
        </div>

        {/* Navigation Actions */}
        <div className="walkthrough-actions">
          {step > 1 ? (
            <button className="btn-secondary" onClick={prevStep} style={{ width: '140px' }}>
              ← Previous
            </button>
          ) : (
            <div style={{ width: '140px' }} /> /* Placeholder to maintain flex alignment */
          )}
          
          <div className="step-indicator">Step {step} of {totalSteps}</div>
          
          {step < totalSteps ? (
            <button className="btn-primary" onClick={nextStep} style={{ width: '140px', margin: 0 }}>
              Next →
            </button>
          ) : (
            <button className="btn-primary start-btn" onClick={onStart} style={{ width: '220px', margin: 0 }}>
              Execute Pipeline
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   WALKTHROUGH STEPS
   ══════════════════════════════════════ */

function Step1Config({ threshold, setThreshold, horizon, setHorizon, error }) {
  return (
    <div className="step-pane animation-fade-in glass-card">
      <div className="step-header">
        <h2>1. Configure the Execution</h2>
        <p>Define the parameters for the forecasting models and the risk threshold for the AI agents.</p>
      </div>

      <div className="config-grid" style={{ gridTemplateColumns: '1fr', maxWidth: '600px', margin: '0 auto' }}>
        <div className="field-group">
          <label className="field-label">Forecast Horizon: <span className="highlight-text">{horizon} days</span></label>
          <p className="field-help">Determines the future prediction window. This automatically reserves the final {horizon} days of the historical dataset as an unseen holdout set to empirically verify model accuracy.</p>
          <div className="horizon-btns">
            {[7, 14, 30].map(d => (
              <button key={d} className={`horizon-btn ${horizon === d ? 'active' : ''}`}
                onClick={() => setHorizon(d)} type="button">{d}d</button>
            ))}
          </div>
        </div>

        <div className="field-group" style={{ marginTop: '24px' }}>
          <label className="field-label">Severity Action Threshold: <span className="highlight-text">{threshold.toFixed(2)}</span></label>
          <p className="field-help" style={{ lineHeight: '1.6' }}>
            Sets the trigger point for emergency grid interventions. The AI calculates an Anomaly Severity Score from 0.0 to 1.0 based on forecast divergence and interval sharpness.
            <br/><br/>
            • <strong>Low Threshold (e.g., 0.10 - 0.30):</strong> Highly aggressive. The AI will recommend spinning up expensive backup generators even for minor forecast deviations. Best for critical peak summer days to prevent blackouts.<br/>
            • <strong>High Threshold (e.g., 0.70 - 0.90):</strong> Highly conservative. The AI will tolerate significant forecast divergence and avoid deploying reserves unless a catastrophic failure is mathematically imminent. Best for stable shoulder months to save money.
          </p>
          <input type="range" className="slider" min="0" max="1" step="0.05"
            value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} />
          <div className="slider-labels">
            <span>0.0 (Highly Aggressive)</span>
            <span>1.0 (Highly Conservative)</span>
          </div>
        </div>

        {error && <div className="error-bar" style={{marginTop: '24px'}}>{error}</div>}
      </div>
    </div>
  );
}

function Step2Models() {
  return (
    <div className="step-pane animation-fade-in glass-card">
      <div className="step-header">
        <h2>2. Dual-Model Architecture</h2>
        <p>The system generates two forecasts using entirely different methodologies to detect structural anomalies.</p>
      </div>

      <div className="explain-grid">
        <div className="explain-card stats-focus">
          <div className="explain-header">
            <div>
              <h4>The Baseline: SARIMA</h4>
              <span className="explain-subtitle">Classical Statistics</span>
            </div>
          </div>
          <div className="explain-body">
            <p><strong>Methodology:</strong> SARIMA analyzes the historical shape of electricity demand—identifying daily cyclical behavior and weekly routines—and mathematically projects that exact pattern forward.</p>
            <p><strong>Implication:</strong> It operates under the assumption that the future will mirror the past. It provides a robust, deterministic baseline but cannot adapt to unprecedented events or sudden regime shifts.</p>
          </div>
        </div>
        
        <div className="explain-card ai-focus">
          <div className="explain-header">
            <div>
              <h4>The Challenger: Chronos</h4>
              <span className="explain-subtitle">Deep Learning Foundation Model</span>
            </div>
          </div>
          <div className="explain-body">
            <p><strong>Methodology:</strong> Amazon Chronos tokenizes time-series data akin to language models tokenizing text. It infers complex, non-linear relationships across massive pre-trained datasets rather than merely extrapolating local history.</p>
            <p><strong>Implication:</strong> It provides a probabilistic forecast via quantile regression. It generates a median prediction (p50) alongside an 80% confidence interval (bounded by the p10 and p90 quantiles). A tighter interval indicates higher model confidence.</p>
          </div>
        </div>
      </div>

      <div className="formula-breakdown">
        <h3 className="card-title" style={{border: 'none', padding: 0}}>The Scorecard: WAPE</h3>
        <p className="muted-text" style={{marginBottom: '16px'}}>
          The system utilizes <strong>Weighted Absolute Percentage Error (WAPE)</strong> to quantify accuracy against the holdout data. 
          A WAPE of 5% indicates the model's total error volume equaled 5% of the actual demand volume. <strong>Lower is better.</strong> 
          If the deep learning model significantly outperforms the statistical baseline, it signals the detection of an anomaly the baseline statistics failed to capture.
        </p>
        <div className="formula-display">
          Sum( |Actual - Forecast| ) / Sum( |Actual| )
        </div>
      </div>
    </div>
  );
}

function Step3Pipeline() {
  return (
    <div className="step-pane animation-fade-in glass-card">
      <div className="step-header">
        <h2>3. LangGraph Agent Execution</h2>
        <p>Following forecast generation, a state machine of seven specialized nodes analyzes the results to formulate a trading mandate.</p>
      </div>

      <div className="pipeline-visual">
        <PipelineNode 
          num="1" name="Data Validator" type="math"
          desc="Acts as the system's frontline safety switch. Before any AI or forecasting runs, it physically inspects the raw grid telemetry (SCADA) data. It looks for dropped sensor feeds, unrealistic load drops, or missing timestamps. If the incoming grid data is corrupted or incomplete, it immediately halts the entire pipeline to prevent the AI from generating dangerous operational directives based on faulty readings."
          importance="Grid sensors drop offline. Telemetry gets delayed. If the AI sees a sudden '0 MW' reading and mistakes it for a massive grid collapse rather than a simple sensor failure, it could recommend deploying millions of dollars in emergency reserves for no reason."
          example="If a transmission line sensor goes down and the reported regional load suddenly drops from 35,000 MW to 2,000 MW, the Data Validator recognizes this as a physical impossibility for the grid. It trips the circuit breaker, stopping the AI from reacting to a phantom blackout."
        />
        
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)', margin: '24px 0', fontSize: '14px', lineHeight: '1.6' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--text-primary)' }}>Why execute in parallel?</h4>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>To make an accurate operational decision, the system needs both <em>pure mathematics</em> and <em>physical context</em> simultaneously. By calculating the raw megawatt divergence (Node 2A) at the exact same time as it evaluates the grid's seasonal stress level (Node 2B), the pipeline slashes execution time in half. Both distinct perspectives are merged instantly to combine quantitative risk with qualitative operational awareness without any lag.</p>
        </div>

        <div className="pipeline-fork">
          <div className="pipeline-branch">
            <PipelineNode 
              num="2A" name="Divergence Analyst" type="math"
              desc="Calculates exactly how much the AI disagrees with the classical statistical model. It measures the megawatt gap between what the baseline expects and what the deep learning model sees coming. If the AI predicts a sudden 5,000 MW demand drop that the baseline completely misses, this node translates that physical divergence into a mathematical 0.0 to 1.0 Severity Score to flag a potential grid anomaly."
              importance="It prevents operators from blindly following a single forecast. By continuously pitting a classical model against a deep learning model, it highlights moments when the grid behaves unpredictably, alerting operators to take manual control."
              example="If the classic model projects a standard 42,000 MW morning ramp, but the AI detects structural signs of an unexpected 35,000 MW industrial curtailment event, the Analyst flags this 16% divergence as a critical anomaly."
            />
          </div>
          <div className="pipeline-parallel-label">Parallel Execution</div>
          <div className="pipeline-branch">
            <PipelineNode 
              num="2B" name="Seasonality Detector" type="llm"
              desc="Analyzes the grid's current physical operating environment—like summer peak cooling or winter heating—to provide critical context for the math. A 500 MW anomaly during a mild spring 'shoulder' month might be easily absorbed by base-load generators, but that exact same 500 MW anomaly during a 100-degree summer heatwave could trigger cascading blackouts."
              importance="Raw numbers don't tell the whole story. This node ensures the system doesn't overreact to minor shifts during low-stress seasons, while remaining hyper-sensitive during critical peak load periods where margins are razor-thin."
              example="If the Divergence Analyst detects a 3% forecast error, the Seasonality Detector checks the calendar. If it's August, it upgrades the threat level due to high AC load. If it's October, it suppresses the alarm, knowing the grid has plenty of spare capacity."
            />
          </div>
        </div>
        
        <PipelineNode 
          num="3" name="RAG Retriever" type="rag"
          desc="Queries a ChromaDB Vector Database to retrieve historical grid events (e.g., severe weather, infrastructure failures) that semantically match the current anomaly pattern."
          importance="Without historical memory, the AI would treat every anomaly as novel — historical precedent provides calibration."
          example="If today's pattern matches the 2014 Polar Vortex buildup, the AI can recommend preemptive action."
        />
        
        <PipelineNode 
          num="4" name="Risk Quantifier" type="math"
          desc="Computes an empirical Value-at-Risk (VaR) profile. By analyzing the delta between the upper (p90) and lower (p10) quantile bounds, it translates the deep learning model's probabilistic uncertainty into definitive upside/downside Megawatt exposure."
          importance="Translates abstract model uncertainty into concrete MW exposure that operators can act on."
          example='"Downside risk: 6,000 MW" means demand could drop that far below the median forecast.'
        />
        
        <div className="pipeline-gate">
          <div className="gate-label">
            <span style={{background: 'rgba(245, 158, 11, 0.2)', padding: '4px 12px', borderRadius: '16px'}}>
              Conditional Router: Is Severity Score {'≥'} User Threshold?
            </span>
          </div>
          <div className="gate-branches">
            <div className="gate-yes">
              <PipelineNode 
                num="5A" name="Strategy Formulator" type="llm"
                desc="Triggered when Severity ≥ Threshold. Functions as the primary grid adjustment engine. Synthesizes the VaR profile, historical RAG context, and seasonal risks to formulate a high-conviction INCREASE GENERATION or DEPLOY RESERVES mandate, complete with precise capacity sizing."
                importance="The synthesis node — it combines all mathematical, seasonal, and historical signals into one actionable decision."
                example="Produces the final 'INCREASE GENERATION' or 'DEPLOY RESERVES' mandate with capacity sizing."
              />
            </div>
            <div className="gate-no">
              <PipelineNode 
                num="5B" name="Conservative Advisory" type="llm"
                desc="Triggered when Severity < Threshold. Acts as the system's risk-mitigation circuit breaker. Classifies the minor forecast divergence as standard market stochasticity and mandates a strict HOLD to preserve capital."
                importance="Acts as a safety valve — prevents the system from overreacting to normal market noise."
                example="When severity is below threshold, it issues MAINTAIN OPS to avoid unnecessary cost."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step4Intelligence() {
  return (
    <div className="step-pane animation-fade-in glass-card">
      <div className="step-header">
        <h2>4. The Intelligence Engine</h2>
        <p>Understanding the exact mathematics of the anomaly trigger and how historical context is utilized.</p>
      </div>

      <div className="intelligence-grid">
        <div className="intelligence-main">
          <h3 className="card-title">The Severity Score (Anomaly Trigger)</h3>
          <p className="muted-text" style={{marginBottom: '16px'}}>
            The severity score dictates the routing of the final recommendation. It is derived through <strong>pure mathematics</strong>, ensuring deterministic and reproducible routing behavior. It combines three normalized signals (scaled 0-1) with the following strict weighting:
          </p>
          
          <div className="formula-display">
            Severity = 0.40(Divergence) + 0.35(WAPE Gap) + 0.25(Sharpness)
          </div>

          <div className="signal-list">
            <div className="signal-item">
              <div className="signal-weight">40%</div>
              <div className="signal-desc">
                <h5>Divergence Magnitude</h5>
                <p>The absolute percentage gap between the Chronos and SARIMA median forecasts. High divergence indicates the deep learning model has detected a trend the statistical baseline failed to capture.</p>
              </div>
            </div>
            <div className="signal-item">
              <div className="signal-weight">35%</div>
              <div className="signal-desc">
                <h5>WAPE Accuracy Gap</h5>
                <p>The difference in accuracy on the historical holdout data. If Chronos demonstrates significantly higher accuracy than SARIMA, the system heavily weights its divergent forecast.</p>
              </div>
            </div>
            <div className="signal-item">
              <div className="signal-weight">25%</div>
              <div className="signal-desc">
                <h5>Band Sharpness</h5>
                <p>The tightness of the Chronos 80% confidence interval (the spread between p10 and p90). A wide interval indicates model uncertainty, which mathematically penalizes the overall severity score.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="intelligence-side">
          <h3 className="card-title">Historical Event Memory (RAG)</h3>
          <p className="muted-text" style={{marginBottom: '16px'}}>
            The AI doesn't just look at numbers — it remembers what happened last time similar patterns appeared on the grid. Node 3 queries a <strong>ChromaDB</strong> vector database containing records of actual grid events.
          </p>
          
          <div className="rag-flow-visual">
            <div className="rag-step"><span>1</span> Current Anomaly Detected</div>
            <div className="rag-arrow">↓</div>
            <div className="rag-step"><span>2</span> Semantic Embedding Generation</div>
            <div className="rag-arrow">↓</div>
            <div className="rag-step"><span>3</span> Vector Search in ChromaDB</div>
            <div className="rag-arrow">↓</div>
            <div className="rag-step"><span>4</span> Match with Historical Context</div>
          </div>
          
          <div className="rag-examples">
            <h5>How it influences the AI:</h5>
            <p><strong>Example A:</strong> If the current divergence matches the signature of the 2014 Polar Vortex, the AI will recommend preemptive action rather than waiting for failure.</p>
            <p><strong>Example B:</strong> If the pattern matches a mild, harmless summer load spike, the AI will issue a "MAINTAIN OPS" advisory, knowing it's not a critical threat.</p>
          </div>

          <div style={{ padding: '16px', background: 'rgba(6, 182, 212, 0.05)', borderRadius: '8px', border: '1px solid rgba(6, 182, 212, 0.2)', marginTop: '24px' }}>
            <h4 style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Manage Database
            </h4>
            <p className="muted-text" style={{ marginBottom: '12px', fontSize: '13px' }}>
              You can inject hypothetical or historical grid events into the database via the <strong>Event Database</strong> view. The AI will immediately utilize these new embeddings during the next execution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineNode({ num, name, type, desc, importance, example }) {
  const [expanded, setExpanded] = useState(false);
  
  const typeLabels = {
    'math': 'Algorithm',
    'llm': 'LLM (Groq)',
    'rag': 'Vector DB'
  };

  return (
    <div className={`pipe-node pipe-${type}`}>
      <div className="pipe-header">
        <span className="pipe-num">{num}</span>
        <strong>{name}</strong>
        <span className={`pipe-type type-${type}`}>{typeLabels[type]}</span>
      </div>
      <p className="pipe-body">{desc}</p>
      
      {importance && example && (
        <details className="node-detail-expandable" open={expanded} onToggle={(e) => setExpanded(e.target.open)}>
          <summary>Learn More</summary>
          <div className="node-detail-content">
            <div className="node-detail-section">
              <h6>Why it matters</h6>
              <p>{importance}</p>
            </div>
            <div className="node-detail-section">
              <h6>Example</h6>
              <p><em>{example}</em></p>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
