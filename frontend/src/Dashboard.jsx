import React, { useState, useMemo } from 'react';

export function Dashboard({ result, elapsed, onNew, onExport, horizon }) {
  const s = useMemo(() => summarize(result, horizon), [result, horizon]);
  const [zoom, setZoom] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  return (
    <div className="dashboard animation-fade-in">
      <header className="dash-header">
        <div>
          <div className="dash-status-row">
            <i className="dot emerald" />
            <span className="dash-status-text">Analysis Complete</span>
            <span className="dash-duration">{fmtDur(elapsed)}</span>
          </div>
          <h1>{s.headline}</h1>
          <p className="subtitle">{s.subtext}</p>
          <p className="dash-explainer">{s.explainer}</p>
        </div>
        <div className="dash-header-right">
          <button className="btn-secondary compact" onClick={onExport} type="button">Export Forecast CSV</button>
          <button className="btn-primary compact" onClick={onNew} type="button">Run New Analysis</button>
        </div>
      </header>

      {/* Top Ticker Row: Metrics */}
      <div className="ticker-row" style={{ marginBottom: '24px' }}>
        <Metric label="SARIMA Baseline Error" value={pct(result.sarima_wape)}
          help="Accuracy of the traditional statistical model. Lower is better." />
        <Metric label="Chronos AI Error" value={pct(result.chronos_wape)}
          help={`The deep learning model's error rate. ${num(result.chronos_wape) <= num(result.sarima_wape) ? 'It outperformed the baseline.' : 'The baseline was more accurate on this run.'}`}
          tone={num(result.chronos_wape) <= num(result.sarima_wape) ? 'good' : 'bad'} />
        <Metric label="Historical Backtest" value={pct(result.sarima_backtest_wape)}
          help="Average SARIMA error across three rolling test windows. Measures consistency." />
        <Metric label="AI Forecast Confidence" value={`${result.trading_mandate?.confidence_score || 0}%`}
          help="How confident the AI agent is in its recommendation, based on model agreement and severity." />
      </div>

      {/* Top: Execution Panel (Horizontal) */}
      <div className="execution-panel top-horizontal-panel">
        <div className="mandate-col">
          <MandateCard result={result} horizontal />
        </div>
        
        <div className="severity-col">
          <span className="kicker" style={{ margin: 0 }}>Algorithmic Severity</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
            <div className="severity-ring" style={{ width: '70px', height: '70px', border: '4px solid var(--glass-border)' }}>
              <span className="severity-num" style={{ fontSize: '22px' }}>{Math.round(num(result.anomaly_severity_score) * 100)}</span>
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Threshold<br/>
              <strong>{num(result.severity_threshold || 0.4).toFixed(2)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Immersive Chart (Full Width) — with Historical Data */}
      <div className="chart-card glass-card" style={{ position: 'relative', marginBottom: '24px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 className="card-title" style={{ margin: 0, fontSize: '20px' }}>Composite Model Analysis</h3>
          <p className="chart-help" style={{ margin: '4px 0 0 0', maxWidth: '80%' }}>
            {showHistory 
              ? 'Full timeline showing historical demand followed by model forecasts. The dashed vertical line marks where history ends and predictions begin.'
              : 'Forecast-window overlay of models against actual demand. Toggle "Show History" to see the full dataset context.'
            }
          </p>
        </div>
        
        <div className="chart-toggle-group">
          <button 
            className={`chart-toggle-btn ${zoom ? 'active' : ''}`} 
            onClick={() => setZoom(!zoom)}
            title="Toggle Y-Axis Focus Scale"
          >
            {zoom ? 'Focus Scale: ON' : 'Focus Scale: OFF'}
          </button>
          <button 
            className={`chart-toggle-btn ${showHistory ? 'active' : ''}`} 
            onClick={() => setShowHistory(!showHistory)}
            title="Toggle Historical Context"
          >
            {showHistory ? 'History: ON' : 'History: OFF'}
          </button>
        </div>
        
        <div style={{ flex: 1, minHeight: '320px' }}>
          <FullChart 
            result={result}
            zoom={zoom}
            showHistory={showHistory}
          />
        </div>
      </div>

      {/* Bottom Row: Drill down charts */}
      <div className="chart-pair" style={{ marginBottom: '24px' }}>
        <ChartCard title="SARIMA Forecast vs Actual" help="The classical model's linear prediction compared against real demand.">
          <SvgChart series={[
            { name: 'Actual', data: nums(result.holdout_data), color: '#ffffff', w: 1.5 },
            { name: 'SARIMA', data: nums(result.sarima_forecast), color: '#f59e0b', w: 1.5 },
          ]} labels={result.forecast_dates} />
        </ChartCard>
        <ChartCard title="Chronos Forecast vs Actual" help="The deep learning model with 80% confidence interval (shaded region).">
          <SvgChart series={[
            { name: 'Actual', data: nums(result.holdout_data), color: '#ffffff', w: 1.5 },
            { name: 'Chronos (p50)', data: nums(result.chronos_p50), color: '#38bdf8', w: 1.5 },
          ]} labels={result.forecast_dates}
            band={{ lo: nums(result.chronos_p10), hi: nums(result.chronos_p90) }} />
        </ChartCard>
      </div>

      <AnalysisTabs result={result} />

      {/* Historical Event Similarity Section */}
      <HistoricalSimilarity result={result} />
      
      <div style={{ paddingBottom: '20px' }}>
        <ExecutionTrace trace={result.graph_execution_trace} />
      </div>
    </div>
  );
}

/* ── Full Chart with Historical Context ── */
function FullChart({ result, zoom, showHistory }) {
  const histData = nums(result.historical_data || []);
  const forecastActual = nums(result.holdout_data);
  const forecastSarima = nums(result.sarima_forecast);
  const forecastChronos = nums(result.chronos_p50);
  const bandLo = nums(result.chronos_p10);
  const bandHi = nums(result.chronos_p90);
  const forecastDates = result.forecast_dates || [];

  if (!showHistory || histData.length === 0) {
    // Original forecast-only view
    return (
      <SvgChart 
        zoom={zoom}
        series={[
          { name: 'Actual Demand', data: forecastActual, color: '#ffffff', w: 1.5 },
          { name: 'SARIMA Baseline', data: forecastSarima, color: '#f59e0b', w: 1.5 },
          { name: 'Chronos (p50)', data: forecastChronos, color: '#38bdf8', w: 2 },
        ]} 
        labels={forecastDates} 
        band={{ lo: bandLo, hi: bandHi }} 
      />
    );
  }

  // Combined historical + forecast view
  const histLen = histData.length;
  const fcLen = forecastActual.length;
  const totalLen = histLen + fcLen;

  // Build combined series: historical only has actual demand line
  const combinedActual = [...histData, ...forecastActual];
  const combinedSarima = [...new Array(histLen).fill(null), ...forecastSarima];
  const combinedChronos = [...new Array(histLen).fill(null), ...forecastChronos];
  const combinedBandLo = [...new Array(histLen).fill(null), ...bandLo];
  const combinedBandHi = [...new Array(histLen).fill(null), ...bandHi];

  // Generate labels: historical dates counted backwards from first forecast date
  const firstForecastDate = forecastDates[0] ? new Date(forecastDates[0]) : new Date();
  const lastForecastDate = forecastDates[forecastDates.length - 1] ? new Date(forecastDates[forecastDates.length - 1]) : new Date();
  const histLabels = [];
  for (let i = histLen; i > 0; i--) {
    const d = new Date(firstForecastDate);
    d.setDate(d.getDate() - i);
    histLabels.push(d.toISOString().split('T')[0]);
  }
  const combinedLabels = [...histLabels, ...forecastDates];

  // Chart dimensions
  const W = 860, H = 340;
  const pad = { t: 40, r: 24, b: 64, l: 64 };

  // Scale calculations
  const allVals = combinedActual.filter(v => v !== null);
  const fcValsForScale = zoom 
    ? [...forecastActual, ...forecastSarima, ...forecastChronos]
    : [...forecastActual, ...forecastSarima, ...forecastChronos, ...bandLo, ...bandHi];
  const allForScale = [...allVals, ...fcValsForScale];
  
  let rawMn = Math.min(...allForScale);
  let rawMx = Math.max(...allForScale);
  let rawRng = rawMx - rawMn || 1;
  const mn = rawMn - (rawRng * 0.1);
  const mx = rawMx + (rawRng * 0.1);
  const rng = mx - mn || 1;

  const x = (i) => totalLen <= 1 ? pad.l : pad.l + (i / (totalLen - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - mn) / rng) * (H - pad.t - pad.b);

  // Divider position
  const dividerX = x(histLen - 0.5);

  // Grid
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTickPositions = [0, 0.2, 0.4, 0.6, 0.8, 1];

  // Build paths - historical actual (continuous line)
  const histActualPath = histData.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
  
  // Forecast paths (start from divider)
  const fcActualPath = forecastActual.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(histLen + i)} ${y(v)}`).join(' ');
  const fcSarimaPath = forecastSarima.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(histLen + i)} ${y(v)}`).join(' ');
  const fcChronosPath = forecastChronos.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(histLen + i)} ${y(v)}`).join(' ');

  // Connection line from last historical to first forecast actual
  const connectionPath = `M ${x(histLen - 1)} ${y(histData[histLen - 1])} L ${x(histLen)} ${y(forecastActual[0])}`;

  // Band polygon (forecast region only)
  const bandD = [
    ...bandHi.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(histLen + i)} ${y(v)}`),
    ...[...bandLo].reverse().map((v, ri) => `L ${x(histLen + bandLo.length - 1 - ri)} ${y(v)}`),
    'Z'
  ].join(' ');

  // Series for legend
  const seriesLegend = [
    { name: 'Actual Demand', color: '#ffffff' },
    { name: 'SARIMA Baseline', color: '#f59e0b' },
    { name: 'Chronos (p50)', color: '#38bdf8' },
  ];

  return (
    <div className="svg-chart-container" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <svg className="svg-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Full Timeline Chart" style={{ width: '100%', height: '100%', display: 'block' }}>
        <rect x="0" y="0" width={W} height={H} rx="12" className="chart-bg" />

        {/* Historical region background tint */}
        <rect x={pad.l} y={pad.t} width={dividerX - pad.l} height={H - pad.t - pad.b} fill="rgba(255,255,255,0.02)" />

        {/* Grid lines */}
        {yTicks.map(t => {
          const yy = pad.t + t * (H - pad.t - pad.b);
          return (<g key={`y-${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} stroke="rgba(255,255,255,0.08)" />
            <text x={pad.l - 12} y={yy + 4} className="axis-text" textAnchor="end">{Math.round(mx - t * rng).toLocaleString()}</text>
          </g>);
        })}

        {/* X-axis labels */}
        {xTickPositions.map(t => {
          const xx = pad.l + t * (W - pad.l - pad.r);
          const labelIdx = Math.floor(t * (combinedLabels.length - 1));
          return (<g key={`x-${t}`}>
            <line x1={xx} x2={xx} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.03)" />
            <text x={xx} y={H - pad.b + 20} className="axis-text" textAnchor="middle">
              {shortDate(combinedLabels[labelIdx])}
            </text>
          </g>);
        })}

        {/* Vertical divider line */}
        <line x1={dividerX} x2={dividerX} y1={pad.t} y2={H - pad.b} stroke="rgba(6, 182, 212, 0.5)" strokeWidth="2" strokeDasharray="8 4" />
        
        {/* Forecast Start Date Marker */}
        <rect x={dividerX - 30} y={pad.t - 22} width="60" height="18" fill="rgba(6, 182, 212, 0.15)" rx="4" />
        <text x={dividerX} y={pad.t - 9} className="axis-text" textAnchor="middle" fill="rgba(6, 182, 212, 1)" style={{ fontSize: '11px', fontWeight: 'bold' }}>
          {shortDate(forecastDates[0])}
        </text>

        {/* Forecast End Date Marker */}
        {forecastDates.length > 1 && (
          <>
            <rect x={x(totalLen - 1) - 30} y={pad.t - 22} width="60" height="18" fill="rgba(16, 185, 129, 0.15)" rx="4" />
            <text x={x(totalLen - 1)} y={pad.t - 9} className="axis-text" textAnchor="middle" fill="rgba(16, 185, 129, 1)" style={{ fontSize: '11px', fontWeight: 'bold' }}>
              {shortDate(forecastDates[forecastDates.length - 1])}
            </text>
          </>
        )}

        {/* Region labels */}
        <text x={(pad.l + dividerX) / 2} y={pad.t + 16} className="axis-text" textAnchor="middle" fill="rgba(255,255,255,0.3)" style={{ fontSize: '11px', letterSpacing: '0.1em' }}>HISTORICAL</text>
        <text x={(dividerX + W - pad.r) / 2} y={pad.t + 16} className="axis-text" textAnchor="middle" fill="rgba(6, 182, 212, 0.6)" style={{ fontSize: '11px', letterSpacing: '0.1em' }}>FORECAST</text>

        {/* Confidence band (forecast region only) */}
        <path d={bandD} fill="rgba(56, 189, 248, 0.12)" stroke="rgba(56, 189, 248, 0.2)" strokeWidth="1" />

        {/* Historical actual demand */}
        <path d={histActualPath} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Connection line */}
        <path d={connectionPath} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="4 3" />

        {/* Forecast actual demand */}
        <path d={fcActualPath} fill="none" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Forecast SARIMA */}
        <path d={fcSarimaPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Forecast Chronos */}
        <path d={fcChronosPath} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Legend */}
        {seriesLegend.map((s, si) => (
          <g key={`lg-${s.name}`} transform={`translate(${pad.l + si * 130}, ${H - 14})`}>
            <line x1="0" x2="16" y1="0" y2="0" stroke={s.color} strokeWidth="2" />
            <text x="22" y="4" className="legend-text" style={{ fontSize: '11px' }}>{s.name}</text>
          </g>
        ))}
        <g transform={`translate(${pad.l + seriesLegend.length * 130}, ${H - 14})`}>
           <rect x="0" y="-4" width="16" height="8" fill="rgba(56, 189, 248, 0.15)" stroke="rgba(56, 189, 248, 0.3)" />
           <text x="22" y="4" className="legend-text" style={{ fontSize: '11px' }}>80% Band</text>
        </g>
      </svg>
    </div>
  );
}

function Metric({ label, value, help, tone = '' }) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value" style={{ fontSize: '28px' }}>{value}</strong>
      <small className="metric-help" style={{ fontSize: '11px', marginTop: '4px', lineHeight: 1.4 }}>{help}</small>
    </div>
  );
}

function ChartCard({ title, help, children }) {
  return (
    <div className="chart-card glass-card">
      <h3 className="card-title" style={{ marginBottom: '4px', fontSize: '16px' }}>{title}</h3>
      <p className="chart-help" style={{ marginBottom: '16px' }}>{help}</p>
      {children}
    </div>
  );
}

function SvgChart({ series, labels = [], band = null, tall = false, zoom = false }) {
  // Using explicit 100% height for flex parent compatibility if tall
  const W = 860, H = tall ? 340 : 280;
  // Standard padding, allowing 10% mathematical padding to prevent clipping
  const pad = { t: 40, r: 24, b: 64, l: 64 };
  
  // Calculate bounds. 
  const allSeries = series.flatMap(s => s.data);
  const allBand = band ? band.lo.concat(band.hi) : [];
  const allForScale = zoom ? allSeries : allSeries.concat(allBand);
  
  let rawMn = Math.min(...allForScale);
  let rawMx = Math.max(...allForScale);
  let rawRng = rawMx - rawMn || 1;
  
  // Add 10% mathematical padding so curves fit naturally without harsh clipping
  const mn = rawMn - (rawRng * 0.1);
  const mx = rawMx + (rawRng * 0.1);
  const rng = mx - mn || 1;
  
  const longest = Math.max(...series.map(s => s.data.length), band?.lo.length || 0);
  
  const x = (i, len = longest) => len <= 1 ? pad.l : pad.l + (i / (len - 1)) * (W - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - mn) / rng) * (H - pad.t - pad.b);
  
  // Fine mathematical grid network
  const yTicks = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  
  // Create a continuous polygon for the shaded confidence band
  const bandD = band ? [
    ...band.hi.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i, band.hi.length)} ${y(v)}`),
    ...[...band.lo].reverse().map((v, ri) => `L ${x(band.lo.length - 1 - ri, band.lo.length)} ${y(v)}`), 'Z'
  ].join(' ') : '';

  return (
    <div className="svg-chart-container" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <svg className="svg-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Forecast Chart" style={{ width: '100%', height: '100%', display: 'block' }}>
        
        <rect x="0" y="0" width={W} height={H} rx="12" className="chart-bg" />
        
        {/* Render fine grid lines and Y-axis text */}
        {yTicks.map(t => {
          const yy = pad.t + t * (H - pad.t - pad.b);
          const isMajor = t === 0 || t === 0.25 || t === 0.5 || t === 0.75 || t === 1;
          return (<g key={`y-${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={yy} y2={yy} className="grid-line" strokeDasharray={isMajor ? "" : "4 4"} stroke={isMajor ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.03)"} />
            {isMajor && <text x={pad.l - 12} y={yy + 4} className="axis-text" textAnchor="end">{Math.round(mx - t * rng).toLocaleString()}</text>}
          </g>);
        })}

        {xTicks.map(t => {
            const xx = pad.l + t * (W - pad.l - pad.r);
            return (<g key={`x-${t}`}>
              <line x1={xx} x2={xx} y1={pad.t} y2={H - pad.b} className="grid-line" stroke="rgba(255,255,255,0.03)" />
              <text x={xx} y={H - pad.b + 20} className="axis-text" textAnchor="middle">
                {shortDate(labels[Math.floor(t * (labels.length - 1))])}
              </text>
            </g>);
        })}
        
        {bandD && <path d={bandD} fill="rgba(56, 189, 248, 0.12)" stroke="rgba(56, 189, 248, 0.2)" strokeWidth="1" />}
        
        {series.map(s => {
          return (
            <path key={s.name}
              d={s.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i, s.data.length)} ${y(v)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={s.w || 1.5}
              strokeLinecap="round" strokeLinejoin="round" />
          );
        })}

        {/* Legend */}
        {series.map((s, si) => (
          <g key={`lg-${s.name}`} transform={`translate(${pad.l + si * 130}, ${H - 14})`}>
            <line x1="0" x2="16" y1="0" y2="0" stroke={s.color} strokeWidth="2" />
            <text x="22" y="4" className="legend-text" style={{ fontSize: '11px' }}>{s.name}</text>
          </g>
        ))}
        {bandD && (
          <g transform={`translate(${pad.l + series.length * 130}, ${H - 14})`}>
             <rect x="0" y="-4" width="16" height="8" fill="rgba(56, 189, 248, 0.15)" stroke="rgba(56, 189, 248, 0.3)" />
             <text x="22" y="4" className="legend-text" style={{ fontSize: '11px' }}>80% Band</text>
          </g>
        )}
      </svg>
    </div>
  );
}

function MandateCard({ result, horizontal = false }) {
  const m = result.trading_mandate || {};
  const rec = (m.recommendation || 'MAINTAIN OPS').toUpperCase();
  const recClass = rec.toLowerCase().replace(/\s+/g, '-');
  
  // Strip old trading terminology from rationale
  let rationale = (m.rationale || result.mandate_narrative || 'No rationale provided.')
    .replace(/\*\*/g, '').replace(/\*/g, '');
  rationale = rationale.replace(/^(BUY|SELL|HOLD|MAINTAIN OPS|INCREASE GENERATION|DEPLOY RESERVES)\s*[—:]\s*/i, '');
    
  return (
    <div className={`mandate-card-wrapper ${horizontal ? 'horizontal-layout' : 'vertical-layout'}`}>
      <div className="mandate-content">
        <span className="kicker" style={{ margin: 0 }}>Generated Grid Mandate</span>
        <h2 className={`rec-text rec-${recClass}`}>{rec}</h2>
        
        <div className="mandate-facts" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>Contract Phase</span>
            <strong style={{ fontSize: '12px' }}>{m.contract_type || 'SPOT'}</strong>
          </div>
        </div>
      </div>
      
      <div className="mandate-rationale-wrapper">
        <p className="mandate-rationale">{rationale}</p>
        
        <div>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', margin: '0 0 4px 0', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            <i className="dot coral" style={{ width: '6px', height: '6px' }} /> Identified Risk Factors
          </h4>
          <ul className="risk-list" style={{ margin: 0, paddingLeft: '16px', fontSize: '12px' }}>
            {(m.risk_factors || ['No risk factors identified.']).map((r, i) => <li key={i} style={{ marginBottom: '2px' }}>{r}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── Historical Event Similarity Section ── */
function HistoricalSimilarity({ result }) {
  const events = result.retrieved_events || [];
  const query = result.rag_query_used || '';
  const direction = result.divergence_direction || 'ALIGNED';
  const magnitude = num(result.variance_magnitude_pct || result.anomaly_severity_score * 100);
  const regime = result.seasonality_regime || 'UNKNOWN';

  if (events.length === 0) return null;

  // Generate a human-readable similarity explanation for each event
  function getSimilarityReason(event) {
    const impact = parseFloat(event.demand_impact_pct) || 0;
    const impactDir = impact > 0 ? 'upward' : impact < 0 ? 'downward' : 'neutral';
    const currentDir = direction.includes('HIGHER') ? 'upward' : direction.includes('LOWER') ? 'downward' : 'neutral';
    
    const reasons = [];
    
    // Direction match
    if (impactDir === currentDir) {
      reasons.push(`Both events show ${impactDir} demand pressure, indicating a similar grid stress pattern.`);
    } else if (impactDir !== 'neutral' && currentDir !== 'neutral') {
      reasons.push(`While this historical event showed ${impactDir} pressure (${impact > 0 ? '+' : ''}${impact}%), the current anomaly trends ${currentDir} — the AI matched on seasonal and contextual similarity.`);
    }
    
    // Severity context
    const sevMap = { 'CRITICAL': 'extreme', 'HIGH': 'significant', 'MEDIUM': 'moderate', 'LOW': 'minor' };
    const sevWord = sevMap[event.severity] || 'notable';
    reasons.push(`This ${sevWord}-severity historical event provides calibration for the AI's risk assessment during the ${regime.toLowerCase()} period.`);

    // Region context
    if (event.grid_region) {
      reasons.push(`Occurred in the ${event.grid_region} region, within the same interconnection as the current analysis.`);
    }

    return reasons.join(' ');
  }

  return (
    <section className="similarity-section glass-card" style={{ padding: '32px', marginBottom: '24px' }}>
      <div className="similarity-header">
        <div>
          <h3 className="card-title" style={{ marginBottom: '4px' }}>
            Historical Event Memory
          </h3>
          <p className="chart-help" style={{ marginBottom: 0 }}>
            The RAG retriever searched the vector database for events semantically similar to the current anomaly pattern. Below are the historical precedents the AI used to calibrate its recommendation.
          </p>
        </div>
      </div>
      
      {/* Semantic Query Used */}
      <div className="similarity-query-box">
        <span className="similarity-query-label">Semantic Search Query</span>
        <code className="similarity-query-text">{query || `${direction.toLowerCase().replace('_', ' ')} magnitude ${magnitude.toFixed(0)}% ${regime.toLowerCase()} season`}</code>
      </div>

      {/* Event Match Cards */}
      <div className="similarity-grid">
        {events.map((event, i) => {
          const sevClass = `sev-${(event.severity || 'medium').toLowerCase()}`;
          return (
            <div key={i} className="similarity-card">
              <div className="similarity-card-header">
                <div className="similarity-card-title">
                  <strong>{event.event_type}</strong>
                  <span className={`sev ${sevClass}`}>{event.severity}</span>
                </div>
                <div className="similarity-card-meta">
                  <span className="impact">{parseFloat(event.demand_impact_pct) > 0 ? '+' : ''}{event.demand_impact_pct}% impact</span>
                  {event.grid_region && <span className="impact">{event.grid_region}</span>}
                </div>
              </div>
              
              <p className="similarity-card-desc">{event.description}</p>
              
              <div className="similarity-basis">
                <span className="similarity-basis-label">
                  <i className="dot" style={{ width: '6px', height: '6px', background: 'var(--accent-cyan)', display: 'inline-block', marginRight: '6px' }} />
                  Why This Matched
                </span>
                <p className="similarity-basis-text">{getSimilarityReason(event)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Connection to current analysis */}
      <div className="similarity-summary">
        <i className="dot emerald" style={{ width: '8px', height: '8px', marginRight: '10px', marginTop: '4px', flexShrink: 0 }} />
        <span>
          The AI identified <strong>{events.length} historical precedent{events.length !== 1 ? 's' : ''}</strong> matching 
          the current {regime.toLowerCase()}-period {direction.toLowerCase().replace('_', ' ')} divergence of {magnitude.toFixed(1)}%. 
          These events informed the final {(result.trading_mandate?.recommendation || 'MAINTAIN OPS').toUpperCase()} recommendation.
        </span>
      </div>
    </section>
  );
}

function AnalysisTabs({ result }) {
  const [tab, setTab] = useState('summary');
  const tabs = [
    ['summary', 'Executive Summary'],
    ['divergence', 'Divergence Report'],
    ['seasonality', 'Seasonality Analysis'],
  ];

  return (
    <section className="analysis-section" style={{ marginBottom: '24px' }}>
      <div className="tab-bar">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} type="button">{l}</button>
        ))}
      </div>
      <div className="tab-content glass-card" style={{ padding: '32px' }}>
        {tab === 'summary' && <SummaryTab result={result} />}
        {tab === 'divergence' && <DivergenceTab result={result} />}
        {tab === 'seasonality' && <SeasonalityTab result={result} />}
      </div>
    </section>
  );
}

function SummaryTab({ result }) {
  return (
    <div className="summary-grid">
      <div className="summary-item">
        <strong>Anomaly Detection</strong>
        <p>The system executed a parallel analysis of historical data and deep learning probabilities. {num(result.anomaly_severity_score) >= num(result.severity_threshold || 0.4) ? 'A significant anomaly was detected that surpassed the defined risk tolerance threshold.' : 'No significant structural anomalies were detected beyond standard market noise.'}</p>
      </div>
      <div className="summary-item">
        <strong>Primary Risk Driver</strong>
        <p>{result.seasonal_risk_factor || 'Continuous monitoring of model convergence is advised to detect emerging physical grid risks.'}</p>
      </div>
      <div className="summary-item">
        <strong>Mandate Justification</strong>
        <p>The composite severity score computed to {num(result.anomaly_severity_score).toFixed(2)}. As this is {num(result.anomaly_severity_score) >= num(result.severity_threshold || 0.4) ? 'above' : 'below'} the designated threshold of {num(result.severity_threshold || 0.4).toFixed(2)}, the pipeline routed execution to the {num(result.anomaly_severity_score) < 0.4 ? 'Conservative Advisory node, yielding a MAINTAIN OPS mandate to mitigate exposure.' : 'Strategy Formulator node, yielding a directive to actively adjust grid position.'}</p>
      </div>
    </div>
  );
}

function DivergenceTab({ result }) {
  return (
    <div>
      <div className="tab-context">
        <strong>Context:</strong> The divergence report quantifies the exact mathematical discrepancy between the SARIMA and Chronos forecasts. High divergence mathematically signals a structural paradigm shift that classical statistics cannot model.
      </div>
      <pre className="code-block">{result.variance_report || 'No divergence report available.'}</pre>
    </div>
  );
}

function SeasonalityTab({ result }) {
  return (
    <div>
      <div className="tab-context">
        <strong>Context:</strong> The Seasonality Detector utilizes a Large Language Model to evaluate the {result.seasonality_regime || 'Unknown'} physical demand regime against the numerical forecast, establishing baseline physical infrastructure risks.
      </div>
      <div className="summary-grid">
        <div className="summary-item">
          <strong>Regime Pattern Analysis</strong>
          <p>{result.seasonal_demand_pattern || 'No physical regime analysis available.'}</p>
        </div>
        <div className="summary-item">
          <strong>Associated Infrastructure Risk</strong>
          <p>{result.seasonal_risk_factor || 'No infrastructure risk factors computed.'}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Visual Execution Trace ── */
function ExecutionTrace({ trace = [] }) {
  const nodeInfo = {
    'validate_data_node': { label: 'Data Validator', type: 'math', desc: 'Verified dataset integrity, length, and variance thresholds.' },
    'divergence_analyst_node': { label: 'Divergence Analyst', type: 'math', desc: 'Executed differential analysis to quantify structural anomaly Severity Score.' },
    'seasonality_detector_node': { label: 'Seasonality Detector', type: 'llm', desc: 'Cross-referenced numerical forecast with expected physical grid conditions.' },
    'rag_retriever_node': { label: 'RAG Retriever', type: 'rag', desc: 'Queried ChromaDB for semantically similar historical disruption events.' },
    'risk_quantifier_node': { label: 'Risk Quantifier', type: 'math', desc: 'Computed empirical VaR bounds using Chronos quantile (p10/p90) spreads.' },
    'strategy_formulator_node': { label: 'Strategy Formulator', type: 'llm', desc: 'Synthesized RAG context and VaR profile into high-conviction grid mandate.' },
    'conservative_advisory_node': { label: 'Conservative Advisory', type: 'llm', desc: 'Classified divergence as market stochasticity; mandated strict MAINTAIN OPS.' },
  };

  return (
    <section className="trace-section glass-card" style={{ padding: '32px' }}>
      <h3 className="card-title">LangGraph State Execution Trace</h3>
      <p className="chart-help">The specific nodes invoked during this pipeline execution. Conditional routing occurred after Node 4.</p>
      
      {/* Container with a styled scrollbar */}
      <div className="trace-flow" style={{ paddingBottom: '16px' }}>
        {trace.map((node, i) => {
          const info = nodeInfo[node] || { label: node, type: 'math', desc: 'Executed standard operation.' };
          return (
            <React.Fragment key={i}>
              {i > 0 && <div className="trace-arrow">&rarr;</div>}
              <div className={`trace-node trace-${info.type}`}>
                <div className="trace-header">
                  <span className="trace-num">NODE {String(i + 1).padStart(2, '0')}</span>
                  <strong>{info.label}</strong>
                </div>
                <p>{info.desc}</p>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

/* ── Helpers ── */
function summarize(r, horizon) {
  const m = r.trading_mandate || {};
  const rec = (m.recommendation || 'MAINTAIN OPS').toUpperCase();
  const recClass = rec.toLowerCase().replace(/\s+/g, '-');
  const sev = num(r.anomaly_severity_score);
  const cW = num(r.chronos_wape), sW = num(r.sarima_wape);
  const better = cW <= sW;
  const level = sev >= (r.severity_threshold || 0.4) ? 'Elevated' : 'Standard';
  
  // Plain-English explainer for non-domain users
  const explainer = better
    ? `In plain terms: our AI predicted electricity demand for the next ${horizon} days and was ${Math.abs((cW - sW) * 100).toFixed(1)} percentage points more accurate than the traditional statistical model.`
    : `In plain terms: the traditional statistical model was slightly more accurate on this ${horizon}-day window, which can happen when demand follows very predictable seasonal patterns.`;

  return {
    rec,
    recClass,
    sevText: sev >= (r.severity_threshold || 0.4) ? 'HIGH' : 'LOW',
    headline: `${level} grid volatility detected over the ${horizon}-day horizon.`,
    subtext: `The deep learning model ${better ? 'outperformed' : 'trailed'} the statistical baseline by ${Math.abs((cW - sW) * 100).toFixed(2)} percentage points.`,
    explainer,
    plain: `The algorithmic severity score computed to ${(sev * 100).toFixed(0)}%. ${sev < (r.severity_threshold || 0.4) ? 'This falls below the designated action threshold; the system advises maintaining current positions.' : 'This exceeds the designated action threshold; the system mandates strategic portfolio adjustment.'}`,
  };
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function nums(a = []) { return (a || []).map(v => Number(v)).filter(Number.isFinite); }
function pct(v) { return `${(num(v) * 100).toFixed(2)}%`; }
function fmtDur(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }
function shortDate(v) { if (!v) return ''; const d = new Date(v); return isNaN(d) ? v : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); }
