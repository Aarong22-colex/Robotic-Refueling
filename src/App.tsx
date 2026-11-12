import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Aperture, Check, CheckCircle2, CircleDot, Crosshair, Gauge, Hand, RotateCcw, Scissors, ShieldCheck, Unplug, Wrench } from 'lucide-react';

type Tool = 'camera' | 'wire-cutter' | 'cap-tool' | 'hose';
type Entry = { time: string; message: string; warn?: boolean };
const queryClient = new QueryClient();
const tools: { id: Tool; name: string; icon: typeof Aperture }[] = [
  { id: 'camera', name: 'Inspection camera', icon: Aperture },
  { id: 'wire-cutter', name: 'Wire cutter', icon: Scissors },
  { id: 'cap-tool', name: 'Cap removal tool', icon: Wrench },
  { id: 'hose', name: 'Refueling hose', icon: Unplug },
];
const stages = ['Inspect module', 'Cut safety wires', 'Remove fuel caps', 'Align hose', 'Transfer ethanol', 'Disconnect & verify'];
const phaseTitle = ['Module inspection', 'Safety wire removal', 'Protective cap removal', 'Hose alignment & capture', 'Fuel transfer', 'Fuel transfer', 'Valve closure', 'Hose disconnect', 'Transfer verification', 'Mission complete'];
const valveTarget = { x: 792, y: 154 };
const formatElapsed = (seconds: number) => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function App() {
  const [phase, setPhase] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedTool, setSelectedTool] = useState<Tool>('camera');
  const [wireCut, setWireCut] = useState(false);
  const [capsRemoved, setCapsRemoved] = useState(false);
  const [secured, setSecured] = useState(false);
  const [valveOpen, setValveOpen] = useState(false);
  const [hoseDisconnected, setHoseDisconnected] = useState(false);
  const [verified, setVerified] = useState(false);
  const [transfer, setTransfer] = useState(0);
  const [transferActive, setTransferActive] = useState(false);
  const [cameraView, setCameraView] = useState(false);
  const [position, setPosition] = useState(valveTarget);
  const [warning, setWarning] = useState('');
  const [log, setLog] = useState<Entry[]>([{ time: '00:00:00', message: 'Simulation initialized. Dextre end effector is parked.' }]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const alignment = useMemo(() => {
    const dx = position.x - valveTarget.x;
    const dy = position.y - valveTarget.y;
    return Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(dx * dx + dy * dy) / 2.7)));
  }, [position]);
  const aligned = alignment >= 90;
  const completedCount = phase >= 8 ? 6 : phase >= 6 ? 5 : phase >= 4 ? 4 : phase;
  const stageIndex = phase <= 2 ? phase : phase === 3 ? 3 : phase <= 5 ? 4 : 5;

  const addLog = (message: string, warn = false) => {
    const stamp = formatElapsed(elapsedSeconds);
    setLog((items) => [{ time: stamp, message, warn }, ...items].slice(0, 24));
  };
  const raiseWarning = (message: string) => {
    setWarning(message);
    addLog(message, true);
  };
  const selectTool = (tool: Tool) => {
    setSelectedTool(tool);
    setWarning('');
    addLog(`${tools.find((item) => item.id === tool)?.name} selected.`);
  };
  const requireTool = (needed: Tool, description: string) => {
    if (selectedTool !== needed) {
      raiseWarning(`Wrong tool: ${description} requires the ${tools.find((item) => item.id === needed)?.name.toLowerCase()}. Select it before proceeding.`);
      return false;
    }
    return true;
  };
  const performAction = () => {
    setWarning('');
    if (phase === 0) {
      if (!requireTool('camera', 'Module inspection')) return;
      setCameraView(true);
      setPhase(1);
      addLog('Module inspected by camera. Retaining wires and protective caps identified.');
    } else if (phase === 1) {
      if (!requireTool('wire-cutter', 'Safety wire removal')) return;
      setWireCut(true);
      setPhase(2);
      addLog('Two retaining safety wires cut and cleared from the service panel.');
    } else if (phase === 2) {
      if (!requireTool('cap-tool', 'Cap removal')) return;
      setCapsRemoved(true);
      setPhase(3);
      addLog('Protective fuel caps removed. Valve interface is exposed.');
    } else if (phase === 3) {
      if (!requireTool('hose', 'Hose capture')) return;
      if (!aligned) {
        raiseWarning(`Hose alignment is ${alignment}%. Reposition the end effector until alignment reaches 90% or higher.`);
        return;
      }
      setSecured(true);
      setPhase(4);
      addLog('Hose seated and secured to the fuel valve. Seal check passed.');
    } else if (phase === 4) {
      if (!secured) { raiseWarning('Hose is not secured. Complete hose alignment and capture first.'); return; }
      setValveOpen(true);
      setPhase(5);
      setTransferActive(true);
      addLog('Fuel valve opened. Simulated ethanol transfer initiated.');
    } else if (phase === 5) {
      raiseWarning('Transfer is in progress. Close the valve only after the receiving tank reaches 100%.');
    } else if (phase === 6) {
      if (!requireTool('hose', 'Hose disconnect')) return;
      if (valveOpen) { raiseWarning('Valve is still open. Close it before disconnecting the hose.'); return; }
      setHoseDisconnected(true);
      setPhase(7);
      addLog('Refueling hose disconnected and stowed clear of the valve.');
    } else if (phase === 7) {
      if (selectedTool !== 'camera') { raiseWarning('Verification requires the inspection camera. Select the camera to confirm the valve and transfer indicators.'); return; }
      setVerified(true);
      setPhase(8);
      addLog(`Transfer verified: ${transfer}% of illustrative tank capacity received. Mission sequence complete.`);
    }
  };

  useEffect(() => {
    if (!transferActive) return;
    const timer = window.setInterval(() => {
      setTransfer((value) => {
        const next = Math.min(100, value + 2);
        if (next >= 100) {
          window.clearInterval(timer);
          setTransferActive(false);
          setPhase((current) => current === 5 ? 6 : current);
          addLog('Transfer target reached. Close valve to continue.');
        }
        return next;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [transferActive]);

  const closeValve = () => {
    if (phase !== 6 || transfer < 100) {
      raiseWarning('Transfer is not complete. Allow the receiving tank to reach 100% before valve closure.');
      return;
    }
    setValveOpen(false);
    addLog('Fuel valve closed. Pressure equalization confirmed.');
  };
  const reset = () => {
    setPhase(0); setSelectedTool('camera'); setWireCut(false); setCapsRemoved(false); setSecured(false);
    setValveOpen(false); setHoseDisconnected(false); setVerified(false); setTransfer(0); setTransferActive(false);
    setElapsedSeconds(0);
    setCameraView(false); setPosition(valveTarget); setWarning('');
    setLog([{ time: '00:00:00', message: 'Simulation reset. Dextre end effector is parked.' }]);
  };
  const actionLabel = phase === 0 ? 'Inspect module' : phase === 1 ? 'Cut retaining wires' : phase === 2 ? 'Remove fuel caps' : phase === 3 ? 'Secure hose' : phase === 4 ? 'Open fuel valve' : phase === 5 ? 'Transfer in progress' : phase === 6 ? 'Disconnect hose' : phase === 7 ? 'Verify transfer' : 'Mission complete';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><CircleDot size={19} /></div>
          <div><div className="brand-title">RRM / SERVICING SIMULATOR</div><div className="brand-sub">ROBOTIC REFUELING MISSION · LEARNING ENVIRONMENT</div></div>
        </div>
        <div className="top-meta"><span className="hide-mobile"><i className="live-dot" />SIMULATION ACTIVE</span><span className="disclaimer">ILLUSTRATIVE RECREATION — NOT NASA SOFTWARE</span></div>
      </header>
      <div className="main">
        <div className="heading-row">
          <div><div className="eyebrow">MISSION 01 · ON-ORBIT SERVICING</div><h1>Refueling sequence</h1></div>
          <div className="mission-number">MISSION ELAPSED<strong data-testid="text-elapsed">{formatElapsed(elapsedSeconds)}</strong></div>
        </div>
        {phase >= 8 && <div className="complete-banner" data-testid="status-mission-success">
          <div><strong>Servicing sequence complete</strong><span>Transfer verified · {transfer}% illustrative tank capacity · Ethanol analog</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 15px', marginTop: 9, fontSize: 9 }}>
              {['Module inspected', 'Safety wires cut', 'Fuel caps removed', 'Hose secured', 'Valve cycled & transfer complete', 'Hose disconnected', 'Transfer verified'].map((item) => <span key={item}><Check size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item}</span>)}
            </div>
          </div>
          <CheckCircle2 size={22} />
        </div>}
        <nav className="step-strip" aria-label="Mission operations">
          {stages.map((name, index) => {
            const done = index < completedCount;
            return <div className={`step ${done ? 'done' : ''} ${index === stageIndex && phase < 8 ? 'current' : ''}`} key={name} data-testid={`stage-${index}`}>
              <small>{done ? 'COMPLETE' : `0${index + 1} / OP`}</small><span>{name}</span>
            </div>;
          })}
        </nav>
        <div className="workspace">
          <section className="panel worksite" aria-label="Robotic servicing worksite">
            <div className="panel-head"><span>Servicing worksite / external view</span><span className="head-right"><span className="status-dot" />Dextre · arm 2</span></div>
            <div className="scene" data-testid="visual-worksite">
              <div className="scene-label scene-tag" style={{ left: 14, top: 14 }}>CAM {cameraView ? '02 / TARGET LOCK' : '01 / WIDE'}</div>
              <div className="scene-label scene-tag" style={{ right: 14, top: 14 }}>RRM MODULE · TARGET A</div>
              {cameraView && <div className="scene-label scene-tag" style={{ left: '43%', top: 51, color: '#70e0e0' }}>VALVE ASSEMBLY IDENTIFIED</div>}
              <svg viewBox="0 0 900 440" role="img" aria-label="Illustrative Dextre robotic arm reaching toward a refueling module">
                <defs>
                  <linearGradient id="moduleGrad" x1="0" x2="1"><stop stopColor="#344650"/><stop offset=".45" stopColor="#81939a"/><stop offset="1" stopColor="#485c65"/></linearGradient>
                  <linearGradient id="armGrad" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d2d6cb"/><stop offset=".55" stopColor="#798b8d"/><stop offset="1" stopColor="#506770"/></linearGradient>
                  <linearGradient id="tankLiquid" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#3bd09b" stopOpacity=".55"/><stop offset="1" stopColor="#1e9d80" stopOpacity=".9"/></linearGradient>
                </defs>
                <g fill="#d0e4ed" opacity=".65">
                  <circle cx="81" cy="77" r="1.4"/><circle cx="225" cy="49" r="1"/><circle cx="340" cy="85" r="1.4"/><circle cx="522" cy="63" r="1"/><circle cx="789" cy="85" r="1.3"/><circle cx="851" cy="165" r="1"/><circle cx="64" cy="212" r="1"/><circle cx="406" cy="35" r="1"/><circle cx="730" cy="45" r="1"/>
                </g>
                <path d="M0 347 Q210 322 425 349 T900 342" fill="none" stroke="#314c59" strokeWidth="2" opacity=".65"/>
                <g transform="translate(650 126)">
                  <rect x="0" y="0" width="190" height="174" rx="5" fill="url(#moduleGrad)" stroke="#a4b4b4" strokeWidth="2"/>
                  <path d="M12 17h165M12 28h165M13 148h162" stroke="#c4d0cc" opacity=".23"/>
                  <rect x="17" y="42" width="79" height="73" fill="#283b44" stroke="#97a6a5"/>
                  <path d="M24 49h65v58H24z" fill="#52666b"/>
                  <path d="M34 55l25 44M70 55 42 103" stroke="#849594" opacity=".65"/>
                  <rect x="111" y="34" width="61" height="94" fill="#3c4d53" stroke="#a3b1af"/>
                  <text x="125" y="61" fill="#c0d0cc" fontSize="11" fontFamily="monospace">RRM</text>
                  <text x="124" y="77" fill="#a6b9b7" fontSize="7" fontFamily="monospace">FUEL PORT</text>
                  <g transform="translate(142 99)">
                    <circle r="17" fill="#24343a" stroke="#c4d2cb" strokeWidth="2"/>
                    <circle r="10" fill={capsRemoved ? '#3ed9d3' : '#b1a578'} stroke="#d2d3bc" strokeWidth="2"/>
                    <circle r="5" fill="#15252a" stroke="#e3e9d9"/>
                    {!capsRemoved && <path d="M-12-12L12 12M12-12L-12 12" stroke="#db7164" strokeWidth="3"/>}
                    {wireCut ? null : <path d="M-21-3 Q-37 8 -20 20M18-6 Q34 4 20 20" fill="none" stroke="#e1aa5d" strokeWidth="2.4"/>}
                    {secured && <circle r="22" fill="none" stroke="#52d0a4" strokeWidth="2" strokeDasharray="4 3"/>}
                  </g>
                  <rect x="122" y="140" width="39" height="22" fill="#162832" stroke="#7c959b"/>
                  <rect x="126" y={161 - Math.max(3, transfer * .17)} width="31" height={Math.max(3, transfer * .17)} fill="url(#tankLiquid)" className="tank-fluid"/>
                  <text x="124" y="138" fill="#9eb2b6" fontSize="6" fontFamily="monospace">RECEIVER TANK</text>
                  <rect x="-11" y="64" width="11" height="48" fill="#87999a" stroke="#b7c4bd"/>
                  <rect x="190" y="64" width="12" height="48" fill="#87999a" stroke="#b7c4bd"/>
                  <path d="M-42 87h42M202 87h35M95-17v17M95 174v20" stroke="#869ca0" strokeWidth="5"/>
                  <path d="M-42 87h-28m-15-20v40m15-20" stroke="#778e96" strokeWidth="4"/>
                </g>
                <g opacity=".8">
                  <rect x="660" y="322" width="129" height="13" fill="#8fa1a0" stroke="#c5d1c8"/>
                  <rect x="673" y="335" width="103" height="21" fill="#3b525a" stroke="#798f92"/>
                  <path d="M691 356v21m66-21v21" stroke="#879995" strokeWidth="6"/>
                  <path d="M662 322l-16-26m137 26 19-25" stroke="#798d91" strokeWidth="5"/>
                </g>
                <g>
                  <rect x="87" y="336" width="92" height="23" rx="3" fill="#66797a" stroke="#b1c0b8" strokeWidth="2"/>
                  <rect x="103" y="359" width="59" height="28" fill="#344b53" stroke="#809493"/>
                  <path d="M117 387v22m34-22v22" stroke="#9caaa2" strokeWidth="6"/>
                  <circle cx="133" cy="334" r="24" fill="#445d64" stroke="#c2ccc1" strokeWidth="3"/>
                  <path d="M133 334 L355 253" stroke="url(#armGrad)" strokeWidth="27" strokeLinecap="round"/>
                  <path d="M133 334 L355 253" stroke="#d5dbd0" strokeWidth="2" opacity=".6"/>
                  <circle cx="355" cy="253" r="25" fill="#647a7c" stroke="#c9d1c7" strokeWidth="3"/>
                  <circle cx="355" cy="253" r="10" fill="#1c343c" stroke="#98aaa5" strokeWidth="3"/>
                  <line x1="355" y1="253" x2={position.x} y2={position.y} stroke="url(#armGrad)" strokeWidth="22" strokeLinecap="round" style={{ transition: 'all .25s ease' }}/>
                  <line x1="355" y1="253" x2={position.x} y2={position.y} stroke="#d5dbd0" strokeWidth="1.5" opacity=".6"/>
                  <circle cx={position.x} cy={position.y} r="19" fill="#60777a" stroke="#d1d8cc" strokeWidth="3" style={{ transition: 'all .25s ease' }}/>
                  <circle cx={position.x} cy={position.y} r="7" fill="#1d3239" stroke="#8b9f9e" strokeWidth="2" style={{ transition: 'all .25s ease' }}/>
                  <g transform={`translate(${position.x} ${position.y})`} style={{ transition: 'transform .25s ease' }}>
                    <path d="M0 18v22m-10 0h20" stroke="#c5d0c5" strokeWidth="6"/>
                    {selectedTool === 'wire-cutter' ? <path d="M-8 40l-10 15m10-15 8 15m-18-15 20 0" fill="none" stroke="#edb566" strokeWidth="4"/> :
                     selectedTool === 'cap-tool' ? <path d="M-10 40v15m20-15v15M-10 54h20" fill="none" stroke="#e6c676" strokeWidth="5"/> :
                      selectedTool === 'hose' ? <><path d="M0 40v8" stroke="#63ced4" strokeWidth="5"/><path d={secured ? `M0 48 C0 80 0 81 0 75` : 'M0 48 C-24 70 -34 72 -49 75'} fill="none" stroke="#42cad0" strokeWidth="5"/><circle cx={secured ? 0 : -49} cy="75" r="5" fill="#53d6d6"/></> :
                     <><path d="M0 40v8" stroke="#81d4da" strokeWidth="5"/><circle cx="0" cy="53" r="8" fill="none" stroke="#76dbe0" strokeWidth="3"/><path d="M0 61v10" stroke="#76dbe0" strokeWidth="2"/></>}
                  </g>
                </g>
                {aligned && phase === 3 && <g><circle cx="792" cy="225" r="30" fill="none" stroke="#5bdfbc" strokeWidth="1.5" strokeDasharray="5 4"/><path d="M772 225h40m-20-20v40" stroke="#5bdfbc" opacity=".7"/></g>}
                <g transform="translate(30 38)" opacity=".8">
                  <path d="M0 15h28M14 1v28" stroke="#57cbd2"/><circle cx="14" cy="15" r="9" fill="none" stroke="#57cbd2"/>
                  <text x="37" y="18" fill="#6b8993" fontFamily="monospace" fontSize="8">LOCAL FRAME · RRM A</text>
                </g>
              </svg>
              <div className="scene-label" style={{ right: 18, bottom: 17 }}>END EFFECTOR // {position.x}, {position.y}</div>
            </div>
            <div className="scene-control">
              <span className="micro-label">End-effector X</span>
              <div className="slider-wrap"><input aria-label="End effector horizontal position" data-testid="input-position-x" type="range" min="440" max="840" value={position.x} onChange={(event) => setPosition((p) => ({ ...p, x: Number(event.target.value) }))}/><span className="micro-label">{position.x}</span></div>
              <span className="micro-label">Y</span>
              <div className="slider-wrap"><input aria-label="End effector vertical position" data-testid="input-position-y" type="range" min="100" max="280" value={position.y} onChange={(event) => setPosition((p) => ({ ...p, y: Number(event.target.value) }))}/><span className="micro-label">{position.y}</span></div>
              <button className="small-button" data-testid="button-reposition" onClick={() => { setPosition(valveTarget); setWarning(''); addLog('End effector repositioned to the calibrated valve target.'); }}>Reposition</button>
            </div>
          </section>
          <aside className="side-column">
            <section className="panel">
              <div className="panel-head"><span>Mission control</span><span className="head-right"><Gauge size={13}/> LIVE</span></div>
              <div className="telemetry">
                <div className="stage-name" data-testid="text-current-stage">{phase === 6 && !valveOpen ? 'Hose disconnect' : phaseTitle[phase] || 'Mission complete'}</div>
                <div className="stage-hint">{phase === 0 ? 'Use the inspection camera to survey the service panel.' : phase === 1 ? 'Cut the two retaining safety wires without disturbing the valve.' : phase === 2 ? 'Remove both protective caps to expose the fuel port.' : phase === 3 ? 'Position the hose tip over the port, then secure the interface.' : phase === 4 ? 'Hose is captured. Open the valve to begin the simulated transfer.' : phase === 5 ? 'Ethanol analog is moving into the receiving tank.' : phase === 6 && valveOpen ? 'Transfer complete. Close the valve before disconnecting the hose.' : phase === 6 ? 'Select the hose to disconnect, then verify the closed valve with the camera.' : phase === 7 ? 'Confirm the closed valve and tank fill using the camera.' : 'All required servicing operations have been completed.'}</div>
                <div className="telemetry-grid">
                  <div className="metric"><label>Current tool</label><strong data-testid="value-tool">{tools.find((item) => item.id === selectedTool)?.name}</strong></div>
                  <div className="metric"><label>Alignment</label><strong className={aligned ? 'green' : 'amber'} data-testid="value-alignment">{alignment}% {aligned ? '· LOCK' : '· ADJUST'}</strong></div>
                  <div className="metric"><label>Hose connection</label><strong data-testid="value-connection" className={secured && !hoseDisconnected ? 'green' : ''}>{hoseDisconnected ? 'DISCONNECTED' : secured ? 'SECURED' : 'OPEN'}</strong></div>
                  <div className="metric"><label>Mission state</label><strong data-testid="value-mission-state" className={phase >= 8 ? 'green' : ''}>{phase >= 8 ? 'SUCCESS' : transferActive ? 'TRANSFERRING' : 'IN PROGRESS'}</strong></div>
                </div>
                <div className="metric" style={{ marginTop: 8 }}><label>Simulated ethanol transfer <span style={{ float: 'right' }}>{transfer}%</span></label><div className="transfer-bar"><span style={{ width: `${transfer}%` }}/></div></div>
                {warning && <div className="warning" role="alert" data-testid="status-warning">{warning}</div>}
                {phase >= 8 && <div className="warning success-note" data-testid="text-completion-summary"><strong>Transfer summary</strong><br/>Ethanol analog: {transfer}% tank capacity · valve closed · hose disconnected · visual verification passed.</div>}
                <div className="action-row">
                  {phase < 8 && !(phase === 6 && valveOpen) && <button className="primary-button" data-testid="button-primary-action" onClick={performAction} disabled={transferActive}>{actionLabel}</button>}
                  {phase === 5 && <button className="small-button" data-testid="button-pause-transfer" onClick={() => { setTransferActive((active) => !active); addLog(transferActive ? 'Transfer paused at the current tank level.' : 'Transfer resumed.'); }}>{transferActive ? 'Pause transfer' : 'Resume transfer'}</button>}
                  {phase === 6 && valveOpen && <button className="primary-button" data-testid="button-close-valve" onClick={closeValve}>Close valve</button>}
                  {phase >= 8 && <button className="primary-button" data-testid="button-reset-success" onClick={reset}>Run again</button>}
                  <button className="danger-button" data-testid="button-reset-mission" onClick={reset} aria-label="Reset mission"><RotateCcw size={13}/> Reset</button>
                </div>
                {phase === 5 && <div className="micro-label" style={{ marginTop: 8 }}>Transfer advances automatically; pause remains available.</div>}
              </div>
            </section>
            <section className="panel tool-panel">
              <div className="panel-head" style={{ margin: '0 -13px' }}><span>Tool changer</span><span className="head-right"><Hand size={13}/> ARM 2</span></div>
              <div className="tool-list">
                {tools.map(({ id, name, icon: Icon }) => <button key={id} className={`tool-button ${selectedTool === id ? 'active' : ''}`} data-testid={`button-tool-${id}`} onClick={() => selectTool(id)} aria-pressed={selectedTool === id}>
                  <span className="tool-name"><span className="tool-icon"><Icon size={15}/></span>{name}</span><span className="tool-state">{selectedTool === id ? 'ACTIVE' : 'SELECT'}</span>
                </button>)}
              </div>
              <div className="micro-label" style={{ marginTop: 9 }}>Selected tool is mounted at end effector.</div>
            </section>
          </aside>
        </div>
        <section className="panel log-panel">
          <div className="panel-head"><span>Operation log</span><span className="head-right"><Crosshair size={12}/> SEQUENCE RECORD</span></div>
          <div className="log-list" aria-live="polite" data-testid="list-operation-log">
            {log.map((entry, index) => <div className={`log-entry ${entry.warn ? 'warn' : ''}`} key={`${entry.time}-${index}`} data-testid={`log-entry-${index}`}><span className="log-time">{entry.time}</span><span className="log-mark">{entry.warn ? '!' : '›'}</span><span>{entry.message}</span></div>)}
          </div>
        </section>
        <div className="footer-note"><span><ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 5 }}/>Illustrative recreation inspired by NASA’s Robotic Refueling Mission experiment.</span><span>Physical measurements, animation, fluid transfer and robotic mechanics are simplified for education.</span></div>
      </div>
    </main>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={App}/><Route component={NotFound}/></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Root() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default Root;
