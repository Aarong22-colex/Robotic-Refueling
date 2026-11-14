import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { Aperture, Check, CheckCircle2, CircleDot, Crosshair, Gauge, Hand, RotateCcw, Scissors, ShieldCheck, Unplug, Wrench, ZoomIn, ZoomOut } from 'lucide-react';
import { advanceTransfer, attemptMissionOperation, createInitialMissionState, getGripWindow, getRequiredTool, getToolName, isToolAvailable, MISSION_STEPS, SIMULATED_TRANSFER_RATE_LPS, TANK_CAPACITY_LITERS, type CameraMode, type ToolId } from './simulator/mission';
import { forwardKinematics, interpolateJointAngles, JOINT_LIMITS, measureAlignment, solveInverseKinematics, solveReachableTarget, targetForStage, type JointAngles, type Point } from './simulator/kinematics';
import { planAutonomousInstruction, type OperatingMode } from './simulator/autonomy';

type Entry = { time: string; message: string; warn?: boolean };
const queryClient = new QueryClient();
const tools: { id: ToolId; icon: typeof Aperture }[] = [
  { id: 'wire-blanket', icon: Scissors },
  { id: 'cap-removal', icon: Wrench },
  { id: 'multifunction', icon: Hand },
  { id: 'nozzle', icon: Unplug },
];
const toolTestIds: Record<ToolId, string> = {
  'wire-blanket': 'button-tool-wire-blanket',
  'cap-removal': 'button-tool-cap-removal',
  multifunction: 'button-tool-multifunction',
  nozzle: 'button-tool-nozzle',
};
const cameraModes: { id: CameraMode; label: string; testId: string }[] = [
  { id: 'overview', label: 'Overview', testId: 'button-camera-overview' },
  { id: 'wrist', label: 'Wrist camera', testId: 'button-camera-wrist' },
  { id: 'worksite', label: 'Worksite close-up', testId: 'button-camera-worksite' },
];
const formatElapsed = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const initialAngles = () => solveInverseKinematics(targetForStage('inspection'));

function App() {
  const [mission, setMission] = useState(createInitialMissionState);
  const [selectedTool, setSelectedTool] = useState<ToolId>('wire-blanket');
  const [cameraMode, setCameraMode] = useState<CameraMode>('overview');
  const [angles, setAngles] = useState<JointAngles>(initialAngles);
  const [mode, setMode] = useState<OperatingMode>('manual');
  const [autoState, setAutoState] = useState<'idle' | 'running' | 'paused' | 'stopped' | 'error' | 'complete'>('idle');
  const [selectedTarget, setSelectedTarget] = useState<Point>(targetForStage('inspection'));
  const [motionActive, setMotionActive] = useState(false);
  const [gripForce, setGripForce] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [warning, setWarning] = useState('');
  const [log, setLog] = useState<Entry[]>([{ time: '00:00:00', message: 'Simulation initialized. Manipulator parked at survey pose.' }]);
  const elapsedRef = useRef(0);
  const missionRef = useRef(mission);
  const anglesRef = useRef(angles);
  const modeRef = useRef(mode);
  const autoStateRef = useRef(autoState);
  const pauseRef = useRef(false);
  const runTokenRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const motionResolveRef = useRef<((value: boolean) => void) | null>(null);
  const mountedRef = useRef(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const target = useMemo(() => targetForStage(mission.stage), [mission.stage]);
  const pose = useMemo(() => forwardKinematics(angles), [angles]);
  const alignment = useMemo(() => measureAlignment(pose.endEffector, target), [pose.endEffector, target]);
  const selectedIk = useMemo(() => solveReachableTarget(selectedTarget, angles), [selectedTarget, angles]);
  const stageIk = useMemo(() => solveReachableTarget(target, angles), [target, angles]);
  const requiredTool = getRequiredTool(mission.stage);
  const liters = TANK_CAPACITY_LITERS * mission.transferPercent / 100;
  const cameraLabel = cameraModes.find((mode) => mode.id === cameraMode)?.label ?? 'Overview';
  const stageIndex = MISSION_STEPS.findIndex((step) => step.id === mission.stage);
  const currentStageLabel = mission.stage === 'complete' ? 'Mission complete' : MISSION_STEPS[stageIndex]?.label ?? 'Mission operation';
  const gripWindow = getGripWindow(mission.stage);
  const selectedToolRef = useRef(selectedTool);
  const cameraRef = useRef(cameraMode);
  const gripRef = useRef(gripForce);

  const addLog = (message: string, warn = false) => {
    const stamp = formatElapsed(elapsedRef.current);
    setLog((items) => [{ time: stamp, message, warn }, ...items].slice(0, 40));
  };
  const raiseWarning = (message: string) => {
    setWarning(message);
    addLog(message, true);
  };
  const commitMission = (next: typeof mission | ((current: typeof mission) => typeof mission)) => {
    const value = typeof next === 'function' ? next(missionRef.current) : next;
    missionRef.current = value;
    setMission(value);
  };
  const commitAngles = (next: JointAngles) => {
    anglesRef.current = next;
    setAngles(next);
  };
  const setAutoStatus = (value: typeof autoState) => {
    autoStateRef.current = value;
    setAutoState(value);
  };
  const cancelMotion = () => {
    runTokenRef.current += 1;
    pauseRef.current = false;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    motionResolveRef.current?.(false);
    motionResolveRef.current = null;
    setMotionActive(false);
  };
  const animateTo = (destination: JointAngles, token: number) => new Promise<boolean>((resolve) => {
    motionResolveRef.current = resolve;
    const start = { ...anglesRef.current };
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 760;
    let elapsed = 0;
    let previous = performance.now();
    setMotionActive(true);
    const tick = (now: number) => {
      if (!mountedRef.current || token !== runTokenRef.current) {
        setMotionActive(false);
        motionResolveRef.current = null;
        resolve(false);
        return;
      }
      if (pauseRef.current) {
        previous = now;
        frameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      elapsed += Math.max(0, now - previous);
      previous = now;
      const progress = Math.min(1, elapsed / duration);
      commitAngles(interpolateJointAngles(start, destination, progress));
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
      else {
        frameRef.current = null;
        setMotionActive(false);
        motionResolveRef.current = null;
        resolve(true);
      }
    };
    frameRef.current = window.requestAnimationFrame(tick);
  });
  const applyOperation = (state: typeof mission, tool: ToolId | null, camera: CameraMode, force: number) => {
    const currentPose = forwardKinematics(anglesRef.current);
    const activeTarget = targetForStage(state.stage);
    const currentAlignment = measureAlignment(currentPose.endEffector, activeTarget);
    return attemptMissionOperation(state, { tool, cameraMode: camera, alignment: currentAlignment, gripForce: force });
  };
  const chooseMode = (next: OperatingMode) => {
    if (modeRef.current === next) return;
    cancelMotion();
    if (autoStateRef.current === 'running' || autoStateRef.current === 'paused') {
      const current = missionRef.current;
      commitMission({ ...current, valveOpen: false, transferActive: false });
      setAutoStatus('stopped');
      addLog('Autonomous run stopped by operating-mode change; valve closed and progress retained.');
    }
    modeRef.current = next;
    setMode(next);
    setWarning('');
    addLog(`${next[0].toUpperCase()}${next.slice(1)} operating mode selected.`);
  };
  const selectTarget = (point: Point) => {
    if (mode === 'autonomous' && (autoState === 'running' || autoState === 'paused')) return;
    setSelectedTarget(point);
    const solution = solveReachableTarget(point, anglesRef.current);
    if (!solution.reachable) {
      setWarning(solution.reason);
    } else {
      setWarning('');
    }
  };
  const workspaceClick = (event: MouseEvent<SVGSVGElement>) => {
    if (mode === 'autonomous' || !svgRef.current) return;
    const svg = svgRef.current;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    selectTarget({ x: Math.round(local.x), y: Math.round(local.y) });
  };
  const confirmAssistedMove = async () => {
    if (mode !== 'assisted' || !selectedIk.reachable) return;
    cancelMotion();
    const token = runTokenRef.current;
    addLog(`Assisted move confirmed: target ${selectedTarget.x}, ${selectedTarget.y}.`);
    const moved = await animateTo(selectedIk.angles, token);
    if (moved) addLog('Manipulator reached the confirmed target pose.');
  };

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((seconds) => {
      elapsedRef.current = seconds + 1;
      return seconds + 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mission.transferActive) return;
    const timer = window.setInterval(() => commitMission((current) => advanceTransfer(current, 2)), 200);
    return () => window.clearInterval(timer);
  }, [mission.transferActive]);

  useEffect(() => {
    if (mission.stage === 'valve-closure' && mission.transferPercent >= 100) {
      setWarning('');
      addLog('Transfer target reached. Receiving tank is at capacity; close the valve to continue.');
    }
  // Stage transition occurs once when advanceTransfer reaches 100%.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission.stage]);

  useEffect(() => {
    selectedToolRef.current = selectedTool;
    cameraRef.current = cameraMode;
    gripRef.current = gripForce;
  }, [selectedTool, cameraMode, gripForce]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      runTokenRef.current += 1;
      motionResolveRef.current?.(false);
      motionResolveRef.current = null;
    };
  }, []);

  const selectTool = (tool: ToolId) => {
    if (mode === 'autonomous' && (autoState === 'running' || autoState === 'paused')) return;
    setSelectedTool(tool);
    setWarning('');
    addLog(`${getToolName(tool)} mounted at the end effector.`);
  };
  const operate = () => {
    if (mode === 'autonomous') return;
    setWarning('');
    const result = applyOperation(missionRef.current, selectedTool, cameraMode, gripForce);
    if (result.warning) {
      setWarning(result.warning);
      addLog(result.warning, true);
      return;
    }
    commitMission(result.state);
    if (result.state.stage !== mission.stage) setSelectedTarget(targetForStage(result.state.stage));
    if (result.event) addLog(result.event);
  };
  const setCamera = (mode: CameraMode) => {
    if (modeRef.current === 'autonomous' && (autoStateRef.current === 'running' || autoStateRef.current === 'paused')) return;
    setCameraMode(mode);
    setWarning('');
    addLog(`${cameraModes.find((item) => item.id === mode)?.label} selected.`);
  };
  const updateGrip = (value: number) => {
    if (mode === 'autonomous' || autoState === 'running' || autoState === 'paused') return;
    setGripForce(value);
    if (gripWindow && (value < gripWindow[0] || value > gripWindow[1])) {
      setWarning(`Grip ${value}% is outside the current safe window (${gripWindow[0]}–${gripWindow[1]}%). Adjust before contact.`);
    } else setWarning('');
  };
  const reposition = async () => {
    if (mode !== 'manual') return;
    const result = solveReachableTarget(target, anglesRef.current);
    if (!result.reachable) {
      setWarning(result.reason);
      return;
    }
    cancelMotion();
    const token = runTokenRef.current;
    const moved = await animateTo(result.angles, token);
    if (!moved) return;
    setWarning('');
    addLog('Manipulator moved to the current stage target using constrained inverse kinematics.');
  };
  const reset = () => {
    cancelMotion();
    setAutoStatus('idle');
    commitMission(createInitialMissionState());
    setSelectedTool('wire-blanket');
    setCameraMode('overview');
    commitAngles(initialAngles());
    setSelectedTarget(targetForStage('inspection'));
    modeRef.current = 'manual';
    setMode('manual');
    setGripForce(50);
    setZoom(1);
    elapsedRef.current = 0;
    setElapsedSeconds(0);
    setWarning('');
    setLog([{ time: '00:00:00', message: 'Simulation reset. Manipulator returned to survey pose.' }]);
  };
  const actionLabel = mission.stage === 'inspection' ? 'Inspect module' :
    mission.stage === 'wire-clearance' ? 'Cut wires & clear blanket' :
    mission.stage === 'cap-removal' ? 'Remove protective cap' :
    mission.stage === 'valve-access' ? 'Open valve guard' :
    mission.stage === 'nozzle-connection' ? 'Connect nozzle' :
    mission.stage === 'transfer' ? 'Open fuel valve' :
    mission.stage === 'valve-closure' ? 'Close fuel valve' :
    mission.stage === 'disconnect' ? 'Disconnect nozzle' :
    mission.stage === 'verification' ? 'Verify & complete report' : 'Mission complete';

  const viewCenter = cameraMode === 'overview' ? { x: 500, y: 325 } : cameraMode === 'wrist' ? pose.endEffector : target;
  const viewWidth = 1000 / zoom;
  const viewHeight = 650 / zoom;
  const viewBox = `${viewCenter.x - viewWidth / 2} ${viewCenter.y - viewHeight / 2} ${viewWidth} ${viewHeight}`;
  const targetReady = alignment.withinTolerance;
  const autoLocked = mode === 'autonomous' && (autoState === 'running' || autoState === 'paused');

  const runAutonomy = async () => {
    if (missionRef.current.stage === 'complete' || (autoStateRef.current !== 'idle' && autoStateRef.current !== 'stopped' && autoStateRef.current !== 'error')) return;
    cancelMotion();
    const token = runTokenRef.current;
    pauseRef.current = false;
    setAutoStatus('running');
    setWarning('');
    addLog('SIMULATED AUTONOMY started. Executing the shared nine-step mission plan.');
    try {
      while (token === runTokenRef.current && !missionIsComplete()) {
        while (pauseRef.current && token === runTokenRef.current) await new Promise((resolve) => window.setTimeout(resolve, 80));
        if (token !== runTokenRef.current) return;
        const currentState = missionRef.current;
        const instruction = planAutonomousInstruction(currentState);
        if (!instruction) break;
        const reach = solveReachableTarget(instruction.target, anglesRef.current);
        if (!reach.reachable) throw new Error(reach.reason);
        if (selectedToolRef.current !== instruction.tool && instruction.tool) {
          setSelectedTool(instruction.tool);
          selectedToolRef.current = instruction.tool;
          addLog(`${getToolName(instruction.tool)} mounted for ${instruction.stage}.`);
        }
        if (cameraRef.current !== instruction.cameraMode) {
          setCameraMode(instruction.cameraMode);
          cameraRef.current = instruction.cameraMode;
          addLog(`${cameraModes.find((item) => item.id === instruction.cameraMode)?.label} selected for ${instruction.stage}.`);
        }
        if (gripRef.current !== instruction.gripForce) {
          setGripForce(instruction.gripForce);
          gripRef.current = instruction.gripForce;
        }
        setSelectedTarget(instruction.target);
        addLog(`Autonomy moving to ${instruction.stage} target (${instruction.target.x}, ${instruction.target.y}).`);
        const reached = await animateTo(reach.angles, token);
        if (!reached || token !== runTokenRef.current) return;
        const operationPose = forwardKinematics(anglesRef.current);
        const operationAlignment = measureAlignment(operationPose.endEffector, instruction.target);
        if (!operationAlignment.withinTolerance) throw new Error(`Alignment check failed at ${instruction.stage}: ${operationAlignment.distance.toFixed(1)} px from target.`);
        const result = attemptMissionOperation(missionRef.current, {
          tool: instruction.tool,
          cameraMode: instruction.cameraMode,
          alignment: operationAlignment,
          gripForce: instruction.gripForce,
        });
        if (result.warning) throw new Error(result.warning);
        commitMission(result.state);
        if (result.event) addLog(result.event);
        if (instruction.stage === 'transfer') {
          while (missionRef.current.stage === 'transfer' && token === runTokenRef.current) {
            while (pauseRef.current && token === runTokenRef.current) await new Promise((resolve) => window.setTimeout(resolve, 80));
            if (token !== runTokenRef.current) return;
            if (!missionRef.current.transferActive && missionRef.current.valveOpen) commitMission((current) => ({ ...current, transferActive: true }));
            await new Promise((resolve) => window.setTimeout(resolve, 100));
          }
        }
      }
      if (token === runTokenRef.current) {
        setAutoStatus('complete');
        addLog('SIMULATED AUTONOMY completed the mission report.');
      }
    } catch (error) {
      if (token !== runTokenRef.current) return;
      const reason = error instanceof Error ? error.message : 'Autonomous sequence failed.';
      commitMission((current) => ({ ...current, valveOpen: false, transferActive: false }));
      setAutoStatus('error');
      setWarning(`Autonomy stopped: ${reason}`);
      addLog(`Autonomy stopped: ${reason}`, true);
    }
  };
  const pauseAutonomy = () => {
    if (autoState !== 'running') return;
    pauseRef.current = true;
    commitMission((current) => current.transferActive ? { ...current, transferActive: false } : current);
    setAutoStatus('paused');
    addLog('Autonomy paused; robot motion and fuel transfer halted.');
  };
  const resumeAutonomy = () => {
    if (autoState !== 'paused') return;
    pauseRef.current = false;
    if (missionRef.current.stage === 'transfer' && missionRef.current.valveOpen) commitMission((current) => ({ ...current, transferActive: true }));
    setAutoStatus('running');
    addLog('Autonomy resumed from the retained mission state.');
  };
  const stopAutonomy = () => {
    if (autoState !== 'running' && autoState !== 'paused') return;
    cancelMotion();
    commitMission((current) => ({ ...current, valveOpen: false, transferActive: false }));
    setAutoStatus('stopped');
    addLog('Autonomy stopped. Fuel valve closed; mission progress retained.');
  };
  const missionIsComplete = () => missionRef.current.stage === 'complete';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><CircleDot size={17} /></div>
          <div><div className="brand-title">RRM / SERVICING SIMULATOR</div><div className="brand-sub">ROBOTIC REFUELING MISSION · LEARNING ENVIRONMENT</div></div>
        </div>
        <div className="top-meta"><span className="hide-mobile"><i className="live-dot" />SIMULATION ACTIVE</span><span className="disclaimer">NOT NASA SOFTWARE · NOT FLIGHT TELEMETRY</span></div>
      </header>
      <div className="main">
        <div className="heading-row">
          <div><div className="eyebrow">MISSION 01 · ON-ORBIT SERVICING TRAINING</div><h1>Refueling sequence</h1></div>
          <div className="mission-number">MISSION ELAPSED<strong data-testid="text-elapsed">{formatElapsed(elapsedSeconds)}</strong></div>
        </div>

        {mission.stage === 'complete' && <section className="complete-banner" data-testid="status-success">
          <div><strong>Servicing sequence complete</strong><span>Transfer verified · {liters.toFixed(2)} L simulated · illustrative ethanol analog</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginTop: 8, fontSize: 9 }}>
              {['Module inspected', 'Wires cut & blanket cleared', 'Cap removed', 'Valve accessed', 'Nozzle connected', 'Transfer complete', 'Valve closed', 'Nozzle disconnected', 'Visual verification'].map((item) => <span key={item}><Check size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item}</span>)}
            </div>
          </div><CheckCircle2 size={21} />
        </section>}

        <nav className="step-strip" aria-label="Mission operation sequence">
          {MISSION_STEPS.map((step, index) => {
            const done = mission.stage === 'complete' || index < stageIndex;
            return <div className={`step ${done ? 'done' : ''} ${index === stageIndex && mission.stage !== 'complete' ? 'current' : ''}`} key={step.id} data-testid={`stage-${step.id}`}>
              <small>{done ? 'COMPLETE' : `0${index + 1} / OP`}</small><span>{step.label}</span>
            </div>;
          })}
        </nav>

        <div className="workspace">
          <section className="panel worksite" aria-label="Orbital robotic servicing worksite">
            <div className="panel-head"><span>External worksite / {cameraLabel}</span><span className="head-right"><span className="status-dot" />DEXTRE · ARM 2</span></div>
            <div className="scene" data-testid="visual-worksite">
              <div className="scene-label scene-tag" style={{ left: 11, top: 11 }} data-testid="value-camera-mode">CAM // {cameraLabel.toUpperCase()} · {zoom.toFixed(1)}×</div>
              <div className="scene-label scene-tag" style={{ right: 11, top: 11 }}>RRM SERVICE MODULE · TARGET A</div>
              <svg ref={svgRef} data-testid="svg-workspace" className={mode === 'autonomous' ? 'workspace-locked' : 'workspace-selectable'} onClick={workspaceClick} viewBox={viewBox} role="img" aria-label={`Orbital servicing scene in ${cameraLabel} view. Click to select a manipulator target. Robotic arm end effector at ${pose.endEffector.x.toFixed(0)}, ${pose.endEffector.y.toFixed(0)}; current target at ${target.x}, ${target.y}.`}>
                <defs>
                  <linearGradient id="earth" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#237d9a"/><stop offset=".45" stopColor="#17455e"/><stop offset="1" stopColor="#0c2436"/></linearGradient>
                  <linearGradient id="module" x1="0" x2="1"><stop stopColor="#445b63"/><stop offset=".45" stopColor="#91a2a0"/><stop offset="1" stopColor="#435860"/></linearGradient>
                  <linearGradient id="arm" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d8ded3"/><stop offset=".5" stopColor="#84999a"/><stop offset="1" stopColor="#526b73"/></linearGradient>
                  <linearGradient id="fluid" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#54d7a1" stopOpacity=".55"/><stop offset="1" stopColor="#23986f" stopOpacity=".95"/></linearGradient>
                  <pattern id="blanket" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0L12 12M12 0L0 12" stroke="#9b9b78" strokeWidth=".7" opacity=".55"/></pattern>
                </defs>
                <rect x="-1000" y="-1000" width="3000" height="3000" fill="#0a1721"/>
                <g fill="#d0e4ed" opacity=".64">
                  <circle cx="81" cy="77" r="1.6"/><circle cx="225" cy="49" r="1.2"/><circle cx="340" cy="85" r="1.7"/><circle cx="522" cy="63" r="1.1"/><circle cx="789" cy="85" r="1.5"/><circle cx="951" cy="165" r="1"/><circle cx="64" cy="212" r="1"/><circle cx="406" cy="35" r="1.2"/><circle cx="730" cy="45" r="1.3"/><circle cx="588" cy="170" r="1"/><circle cx="274" cy="182" r="1.4"/>
                </g>
                <circle cx="196" cy="132" r="143" fill="url(#earth)" stroke="#5aa4b6" strokeWidth="2" opacity=".9"/>
                <path d="M72 120q25-54 83-43l15 23 35-4 11 25-38 18-9 28-48 12-19 37-38-21-15-39zM215 17l38 21 24 48-15 23-23-8-14-35-31-18z" fill="#367469" opacity=".58"/>
                <path d="M28 285Q280 238 505 277T1050 264" fill="none" stroke="#31515d" strokeWidth="1.3" strokeDasharray="5 8"/>
                <text x="65" y="307" fill="#638693" fontSize="9" fontFamily="monospace" letterSpacing="2">LOW EARTH ORBIT · SIMULATED SCENE</text>
                {/* Service module chassis */}
                <g>
                  <path d="M718 108h220v246H718z" fill="url(#module)" stroke="#b7c8c2" strokeWidth="2"/>
                  <path d="M729 120h197v14H729zM729 338h197v8H729z" fill="#293e48" stroke="#a4b5b4"/>
                  <path d="M736 148h76v119h-76z" fill="#263a44" stroke="#9baead"/>
                  <path d="M745 159h58v94h-58z" fill="url(#blanket)" stroke="#889895"/>
                  {!mission.blanketCleared && <path d="M745 159h58l-12 34-24 14-22-12z" fill="url(#blanket)" stroke="#d2c88a" strokeWidth="2"><animate attributeName="d" dur=".45s" fill="freeze" values="M745 159h58v94h-58z;M745 159h58l-12 34-24 14-22-12z"/></path>}
                  <text x="747" y="280" fill="#a3b8b7" fontSize="7" fontFamily="monospace">THERMAL BLANKET</text>
                  <rect x="824" y="141" width="94" height="138" fill="#344a53" stroke="#acbcb8"/>
                  <text x="837" y="163" fill="#cfddda" fontSize="13" fontFamily="monospace" letterSpacing="2">RRM</text>
                  <text x="833" y="178" fill="#9db2b5" fontSize="7" fontFamily="monospace">FUEL PORT / A</text>
                  {/* independent port, wires and removable cap */}
                  <circle cx="840" cy="290" r="34" fill="#1a2e38" stroke="#bdcbc3" strokeWidth="2"/>
                  <circle cx="840" cy="290" r="25" fill="#536971" stroke="#d0d7c9" strokeWidth="2"/>
                  <circle cx="840" cy="290" r="14" fill={mission.capRemoved ? '#18333b' : '#998e68'} stroke="#d5d2b9" strokeWidth="2"/>
                  <circle cx="840" cy="290" r="7" fill="#081820" stroke="#9eb0ab"/>
                  {!mission.capRemoved && <g><path d="M829 279l22 22M851 279l-22 22" stroke="#d37869" strokeWidth="3"/><path d="M868 286h22v9h-22" fill="#c3b989" stroke="#ece1b0" strokeWidth="2"/><circle cx="891" cy="290" r="5" fill="#d6c994"/></g>}
                  {!mission.wiresCut && <g fill="none" stroke="#e3b46b" strokeWidth="3"><path d="M813 274q-24-23-30 4t22 30"/><path d="M866 272q22-24 30 0t-21 36"/></g>}
                  {mission.valveAccessed && <path d="M821 270l-16-19m16 19 18-16" stroke="#6bd3b4" strokeWidth="4"/>}
                  <text x="817" y="338" fill="#a4b7b7" fontSize="7" fontFamily="monospace">SERVICE INTERFACE</text>
                  {/* receiver vessel and simulated fluid */}
                  <text x="848" y="202" fill="#b4c7c4" fontSize="7" fontFamily="monospace">RECEIVER TANK</text>
                  <rect x="855" y="210" width="44" height="56" rx="3" fill="#142731" stroke="#9bafad" strokeWidth="2"/>
                  <rect x="859" y={262 - 48 * mission.transferPercent / 100} width="36" height={Math.max(1, 48 * mission.transferPercent / 100)} fill="url(#fluid)" className="tank-fluid"/>
                  <path d="M855 220h44M855 231h44M855 242h44M855 253h44" stroke="#6d8b8e" opacity=".45"/>
                  <text x="861" y="276" fill="#93aaa9" fontSize="7" fontFamily="monospace">{mission.transferPercent}%</text>
                  {/* tool storage bay */}
                  <path d="M664 360h160v49H664z" fill="#384f58" stroke="#91a5a3" strokeWidth="2"/>
                  <path d="M676 371h136v27H676z" fill="#172b35" stroke="#789196"/>
                  <path d="M686 378h27v14h-27zm38 0h27v14h-27zm38 0h27v14h-27zm38 0h14v14h-14z" fill="#657d80" stroke="#a4b6b2"/>
                  <text x="674" y="424" fill="#8ea4a6" fontSize="7" fontFamily="monospace">TOOL STORAGE BAY / 04</text>
                  {/* truss / solar array structure */}
                  <path d="M718 204h-92m0-61v122m-32-61h124M938 204h56m-15-46v94m-26-48h64" fill="none" stroke="#82989a" strokeWidth="5"/>
                  <path d="M642 142v124m-22-124v124m-22-124v124M968 158v92m-22-92v92m44-92v92" stroke="#3e6975" strokeWidth="1"/>
                  <path d="M620 142h98m-98 31h98m-98 31h98m-98 31h98M946 158h44m-44 31h44m-44 31h44m-44 30h44" stroke="#5d8792" strokeWidth="1"/>
                </g>
                {/* Manipulator base and true two-link pose */}
                <g>
                  <rect x="88" y="514" width="125" height="27" fill="#718785" stroke="#c0ccc1" strokeWidth="2"/>
                  <rect x="109" y="541" width="84" height="43" fill="#344a53" stroke="#82999a"/>
                  <path d="M124 584v21m53-21v21" stroke="#a2b1a8" strokeWidth="8"/>
                  <circle cx={pose.base.x} cy={pose.base.y} r="30" fill="#445f67" stroke="#cfdbcf" strokeWidth="3"/>
                  <circle cx={pose.base.x} cy={pose.base.y} r="13" fill="#182f38" stroke="#94abaa" strokeWidth="3"/>
                  <line className="arm-part" x1={pose.base.x} y1={pose.base.y} x2={pose.elbow.x} y2={pose.elbow.y} stroke="url(#arm)" strokeWidth="30" strokeLinecap="round"/>
                  <line x1={pose.base.x} y1={pose.base.y} x2={pose.elbow.x} y2={pose.elbow.y} stroke="#e0e5d7" strokeWidth="2" opacity=".5"/>
                  <circle className="joint" cx={pose.elbow.x} cy={pose.elbow.y} r="25" fill="#647d80" stroke="#d1d9ce" strokeWidth="3"/>
                  <circle cx={pose.elbow.x} cy={pose.elbow.y} r="10" fill="#1c343c" stroke="#a1b3ae" strokeWidth="3"/>
                  <line className="arm-part" x1={pose.elbow.x} y1={pose.elbow.y} x2={pose.endEffector.x} y2={pose.endEffector.y} stroke="url(#arm)" strokeWidth="24" strokeLinecap="round"/>
                  <line x1={pose.elbow.x} y1={pose.elbow.y} x2={pose.endEffector.x} y2={pose.endEffector.y} stroke="#e0e5d7" strokeWidth="1.6" opacity=".55"/>
                  <circle className="joint" cx={pose.endEffector.x} cy={pose.endEffector.y} r="19" fill="#617a7d" stroke="#d1d8cc" strokeWidth="3"/>
                  <circle cx={pose.endEffector.x} cy={pose.endEffector.y} r="7" fill="#1d3239" stroke="#8b9f9e" strokeWidth="2"/>
                  <g transform={`translate(${pose.endEffector.x} ${pose.endEffector.y}) rotate(${pose.toolAngleDeg})`}>
                    <path d="M0 16v18m-8 0h16" stroke="#c5d0c5" strokeWidth="6"/>
                    {selectedTool === 'wire-blanket' ? <g stroke="#e5bc73" fill="none" strokeWidth="3"><path d="M-8 34l-11 15m11-15 8 15m-19-15h20"/><path d="M-14 35l-5-6m16 6 5-6"/></g> :
                      selectedTool === 'cap-removal' ? <g stroke="#e6d28f" fill="none" strokeWidth="4"><path d="M-9 34v14m18-14v14M-10 48h20"/><circle cy="53" r="5"/></g> :
                      selectedTool === 'nozzle' ? <g><path d="M0 34v17" stroke="#62d6d8" strokeWidth="5"/><path d={mission.nozzleConnected ? 'M0 51C0 77 8 81 26 84' : 'M0 51C-8 71-25 77-45 82'} fill="none" stroke="#42cbd1" strokeWidth="5"/><circle cx={mission.nozzleConnected ? 26 : -45} cy="82" r="6" fill="#66e0df"/></g> :
                      <g stroke="#71d9bd" fill="none" strokeWidth="3"><path d="M0 34v21m-9 0 9 10 9-10"/><circle cy="50" r="10"/><path d="M-15 40l-7-6m37 6 7-6"/></g>}
                  </g>
                </g>
                {/* Hose path follows arm tip into the fuel port after capture */}
                {mission.nozzleConnected && <path d={`M${pose.endEffector.x} ${pose.endEffector.y + 55} C${pose.endEffector.x + 40} ${pose.endEffector.y + 130}, 810 390, 840 290`} fill="none" stroke="#42cbd1" strokeWidth="5" strokeDasharray={mission.valveOpen ? '9 5' : 'none'}><animate attributeName="stroke-dashoffset" from="0" to="-28" dur="1s" repeatCount="indefinite"/></path>}
                {mission.transferActive && <g fill="#8ff2d1"><circle r="4"><animateMotion dur="1.4s" repeatCount="indefinite" path="M840 290 C820 310 840 365 870 375"/></circle><circle r="3"><animateMotion dur="1.8s" repeatCount="indefinite" path="M840 290 C820 310 840 365 870 375"/></circle></g>}
                {/* Capture target and crosshair tracking */}
                <g aria-label="Current stage target">
                  <circle cx={target.x} cy={target.y} r={alignment.tolerance} fill="none" stroke={targetReady ? '#65d99e' : '#51d3dc'} strokeWidth="1.5" strokeDasharray="4 4"/>
                  <path d={`M${target.x - 13} ${target.y}h26M${target.x} ${target.y - 13}v26`} stroke={targetReady ? '#65d99e' : '#51d3dc'} strokeWidth="1.4"/>
                  <circle cx={target.x} cy={target.y} r="3" fill="#72e1df"/>
                  <text x={target.x + 20} y={target.y - 20} fill="#81dfe0" fontSize="8" fontFamily="monospace">TARGET / {mission.stage.toUpperCase()}</text>
                </g>
                <g aria-label="Selected move target" pointerEvents="none">
                  <circle cx={selectedTarget.x} cy={selectedTarget.y} r="10" fill="none" stroke={selectedIk.reachable ? '#f2cb76' : '#e58c75'} strokeWidth="1.5"/>
                  <path d={`M${selectedTarget.x - 15} ${selectedTarget.y}h30M${selectedTarget.x} ${selectedTarget.y - 15}v30`} stroke={selectedIk.reachable ? '#f2cb76' : '#e58c75'} strokeWidth="1"/>
                  <circle cx={selectedTarget.x} cy={selectedTarget.y} r="2.5" fill={selectedIk.reachable ? '#f2cb76' : '#e58c75'}/>
                  <text x={selectedTarget.x + 17} y={selectedTarget.y + 20} fill={selectedIk.reachable ? '#f2cb76' : '#e58c75'} fontSize="8" fontFamily="monospace">SELECTED / IK {selectedIk.reachable ? 'READY' : 'BLOCKED'}</text>
                </g>
                <g>
                  <path d={`M${pose.endEffector.x - 9} ${pose.endEffector.y}h18M${pose.endEffector.x} ${pose.endEffector.y - 9}v18`} stroke="#f2cb76" strokeWidth="1"/>
                  <circle cx={pose.endEffector.x} cy={pose.endEffector.y} r="4" fill="none" stroke="#f2cb76"/>
                </g>
                <g transform="translate(28 34)" opacity=".85">
                  <path d="M0 15h28M14 1v28" stroke="#57cbd2"/><circle cx="14" cy="15" r="9" fill="none" stroke="#57cbd2"/>
                  <text x="38" y="18" fill="#7897a1" fontFamily="monospace" fontSize="8">LOCAL FRAME · RRM A</text>
                </g>
              </svg>
              <div className="scene-label" style={{ right: 12, bottom: 12 }}>EE {pose.endEffector.x.toFixed(0)} / {pose.endEffector.y.toFixed(0)} · {alignment.withinTolerance ? 'CAPTURE READY' : 'TRACKING'}</div>
            </div>
            <div className="scene-control">
              <span className="micro-label">Shoulder</span>
              <div className="slider-wrap"><input aria-label="Shoulder joint angle" data-testid="input-joint-shoulder" type="range" min={JOINT_LIMITS.shoulder[0]} max={JOINT_LIMITS.shoulder[1]} step="1" disabled={mode !== 'manual' || motionActive} value={Math.round(angles.shoulderDeg)} onChange={(event) => commitAngles({ ...anglesRef.current, shoulderDeg: Number(event.target.value) })}/><span className="micro-label" data-testid="value-shoulder-angle">{angles.shoulderDeg.toFixed(0)}°</span></div>
              <span className="micro-label">Elbow</span>
              <div className="slider-wrap"><input aria-label="Elbow joint angle" data-testid="input-joint-elbow" type="range" min={JOINT_LIMITS.elbow[0]} max={JOINT_LIMITS.elbow[1]} step="1" disabled={mode !== 'manual' || motionActive} value={Math.round(angles.elbowDeg)} onChange={(event) => commitAngles({ ...anglesRef.current, elbowDeg: Number(event.target.value) })}/><span className="micro-label" data-testid="value-elbow-angle">{angles.elbowDeg.toFixed(0)}°</span></div>
               {mode === 'manual' && <button className="small-button" data-testid="button-move-to-target" onClick={reposition} disabled={!stageIk.reachable || motionActive} aria-label="Move manipulator to current stage target">Move to target</button>}
               {mode === 'assisted' && <button className="primary-button assisted-confirm" data-testid="button-assisted-confirm" onClick={confirmAssistedMove} disabled={!selectedIk.reachable || motionActive}>Confirm Move</button>}
               {mode === 'autonomous' && <span className="auto-control-label">{autoState === 'running' ? 'AUTONOMY ACTIVE' : autoState === 'paused' ? 'AUTONOMY PAUSED' : 'JOINTS LOCKED'}</span>}
            </div>
          </section>

          <aside className="side-column">
            <section className="panel">
              <div className="panel-head"><span>Mission control</span><span className="head-right"><Gauge size={12}/> LIVE</span></div>
              <div className="telemetry">
                <div className="mode-block">
                  <div className="control-head"><span className="micro-label">Operating mode</span><span className="micro-label">CONTROL AUTHORITY</span></div>
                  <div className="mode-row" role="group" aria-label="Operating mode">
                    <button className={`mode-button ${mode === 'manual' ? 'active' : ''}`} data-testid="button-mode-manual" onClick={() => chooseMode('manual')} aria-pressed={mode === 'manual'}>Manual</button>
                    <button className={`mode-button ${mode === 'assisted' ? 'active' : ''}`} data-testid="button-mode-assisted" onClick={() => chooseMode('assisted')} aria-pressed={mode === 'assisted'}>Assisted</button>
                    <button className={`mode-button ${mode === 'autonomous' ? 'active' : ''}`} data-testid="button-mode-autonomous" onClick={() => chooseMode('autonomous')} aria-pressed={mode === 'autonomous'}>Autonomous</button>
                  </div>
                  <div className={`auto-status ${mode === 'autonomous' ? 'simulated' : ''}`} data-testid="status-auto-state"><span className="status-dot"/>{mode === 'autonomous' ? `SIMULATED AUTONOMY · ${autoState.toUpperCase()}` : `${mode.toUpperCase()} CONTROL · ${motionActive ? 'MOVE IN PROGRESS' : 'READY'}`}</div>
                  {mode === 'autonomous' && <div className="autonomy-controls">
                    {(autoState === 'idle' || autoState === 'stopped' || autoState === 'error') && mission.stage !== 'complete' && <button className="primary-button" data-testid="button-autonomy-start" onClick={runAutonomy}>Start sequence</button>}
                    {autoState === 'running' && <button className="small-button" data-testid="button-autonomy-pause" onClick={pauseAutonomy}>Pause autonomy</button>}
                    {autoState === 'paused' && <button className="primary-button" data-testid="button-autonomy-resume" onClick={resumeAutonomy}>Resume autonomy</button>}
                    {(autoState === 'running' || autoState === 'paused') && <button className="danger-button" data-testid="button-autonomy-stop" onClick={stopAutonomy}>Stop</button>}
                    {autoState === 'complete' && <span className="auto-complete">SEQUENCE COMPLETE · REPORT READY</span>}
                  </div>}
                </div>
                <div className="stage-name" data-testid="text-current-stage">{currentStageLabel}</div>
                <div className="stage-hint">{mission.stage === 'inspection' ? 'Survey the module from a focused camera before working near hardware.' : mission.stage === 'wire-clearance' ? 'Bring the mounted combination tool to the retaining wires and blanket edge.' : mission.stage === 'cap-removal' ? 'Remove and secure the protective cap without contacting the exposed port.' : mission.stage === 'valve-access' ? 'Open the valve guard using the Multifunction Tool.' : mission.stage === 'nozzle-connection' ? 'Align and capture the nozzle inside the target tolerance.' : mission.stage === 'transfer' ? mission.transferActive ? 'Illustrative fluid is moving into the receiver. Pause or monitor the fill.' : 'Nozzle secured. Open the valve to begin the simulated transfer.' : mission.stage === 'valve-closure' ? 'Tank target reached. Close the valve before disconnecting.' : mission.stage === 'disconnect' ? 'Disconnect the nozzle only after confirming the valve is closed.' : mission.stage === 'verification' ? 'Use Worksite Close-Up to confirm closed valve and filled tank.' : 'All required servicing operations are complete.'}</div>
                <div className="telemetry-grid">
                  <div className="metric"><label>Mounted tool</label><strong>{getToolName(selectedTool)}</strong></div>
                  <div className="metric"><label>Tool readiness</label><strong className={requiredTool === selectedTool || !requiredTool ? 'green' : 'amber'}>{requiredTool ? isToolAvailable(selectedTool, mission.stage) ? 'READY' : `USE ${getToolName(requiredTool)}` : 'NO TOOL REQUIRED'}</strong></div>
                  <div className="metric"><label>Alignment</label><strong className={targetReady ? 'green' : 'amber'} data-testid="value-alignment">{alignment.alignmentPercent}% · {targetReady ? 'IN TOLERANCE' : 'ADJUST'}</strong></div>
                  <div className="metric"><label>Target distance</label><strong data-testid="value-target-distance">{alignment.distance.toFixed(1)} / {alignment.tolerance} px</strong></div>
                  <div className="metric"><label>Alignment error</label><strong data-testid="value-alignment-error">{alignment.distance.toFixed(1)} px</strong></div>
                  <div className="metric"><label>End effector X / Y</label><strong><span data-testid="value-end-effector-x">{pose.endEffector.x.toFixed(1)}</span> / <span data-testid="value-end-effector-y">{pose.endEffector.y.toFixed(1)}</span></strong></div>
                  <div className="metric"><label>Target X / Y</label><strong><span data-testid="value-target-x">{target.x}</span> / <span data-testid="value-target-y">{target.y}</span></strong></div>
                  <div className="metric"><label>Selected target X / Y</label><strong><span data-testid="value-selected-target-x">{selectedTarget.x}</span> / <span data-testid="value-selected-target-y">{selectedTarget.y}</span></strong></div>
                  <div className="metric"><label>IK shoulder / elbow</label><strong>{selectedIk.reachable ? <><span data-testid="value-ik-shoulder">{selectedIk.angles.shoulderDeg.toFixed(1)}°</span> / <span data-testid="value-ik-elbow">{selectedIk.angles.elbowDeg.toFixed(1)}°</span></> : <span className="amber">NO SOLUTION</span>}</strong></div>
                  <div className="metric"><label>Operating mode</label><strong data-testid="value-operating-mode">{mode.toUpperCase()}</strong></div>
                  <div className="metric"><label>Connection</label><strong className={mission.nozzleConnected ? 'green' : ''}>{mission.nozzleConnected ? 'CONNECTED' : 'OPEN'}</strong></div>
                  <div className="metric"><label>Fuel valve</label><strong className={mission.valveOpen ? 'amber' : 'green'} data-testid="value-valve-status">{mission.valveOpen ? 'OPEN' : 'CLOSED'}</strong></div>
                  <div className="metric"><label>Mission state</label><strong className={mission.stage === 'complete' ? 'green' : ''}>{mission.stage === 'complete' ? 'SUCCESS' : mission.transferActive ? 'TRANSFERRING' : 'IN PROGRESS'}</strong></div>
                </div>
                <div className="metric" style={{ marginTop: 7 }}><label>Simulated ethanol analog <span style={{ float: 'right' }}>{mission.transferPercent}%</span></label><div className="transfer-bar"><span style={{ width: `${mission.transferPercent}%` }}/></div><strong data-testid="value-transfer-liters">{liters.toFixed(2)} L / {TANK_CAPACITY_LITERS} L</strong><span className="micro-label" data-testid="value-transfer-rate">Illustrative rate · {SIMULATED_TRANSFER_RATE_LPS.toFixed(1)} L/s</span></div>
                <div className="micro-label" style={{ marginTop: 6 }}>Simulated volume only — not real telemetry</div>
                {warning && <div className="warning" role="alert" data-testid="status-warning">{warning}</div>}
                <div className={`ik-status ${selectedIk.reachable ? 'ok' : 'blocked'}`} role="status" data-testid="status-ik-warning">{selectedIk.reachable ? 'Selected target has a valid IK solution within joint limits.' : selectedIk.reason}</div>
                {mission.stage === 'complete' && <div className="warning success-note"><strong>Mission report</strong><br/>Verified volume: {liters.toFixed(2)} L of {TANK_CAPACITY_LITERS} L. Valve closed; nozzle disconnected; worksite visually verified. All values are simplified instructional mechanics.</div>}
                <div className="action-row">
                  {mode !== 'autonomous' && mission.stage !== 'complete' && mission.stage !== 'transfer' && <button className="primary-button" data-testid="button-primary-action" onClick={operate}>{actionLabel}</button>}
                  {mode !== 'autonomous' && mission.stage === 'transfer' && !mission.valveOpen && !mission.transferActive && <button className="primary-button" data-testid="button-primary-action" onClick={operate}>{actionLabel}</button>}
                  {mode !== 'autonomous' && mission.stage === 'transfer' && <button className="small-button" data-testid="button-pause-transfer" onClick={() => { commitMission((current) => ({ ...current, transferActive: !current.transferActive })); addLog(mission.transferActive ? 'Transfer paused at current receiver level.' : 'Transfer resumed.'); }}>{mission.transferActive ? 'Pause transfer' : 'Resume transfer'}</button>}
                  {mission.stage === 'complete' && <button className="primary-button" onClick={reset}>Run again</button>}
                  <button className="danger-button" data-testid="button-reset-mission" onClick={reset} aria-label="Reset all mission state"><RotateCcw size={12}/> Reset</button>
                </div>
                {mission.stage === 'transfer' && <div className="micro-label" style={{ marginTop: 7 }}>Rate {SIMULATED_TRANSFER_RATE_LPS.toFixed(1)} L/s · tank {TANK_CAPACITY_LITERS} L · accelerated illustrative timing.</div>}
              </div>
            </section>

            <section className="panel tool-panel">
              <div className="panel-head" style={{ margin: '0 -11px' }}><span>Tool changer</span><span className="head-right"><Hand size={12}/> ARM 2</span></div>
              <div className="tool-list">
                {tools.map(({ id, icon: Icon }) => <button key={id} className={`tool-button ${selectedTool === id ? 'active' : ''} ${requiredTool === id ? 'ready' : ''}`} data-testid={toolTestIds[id]} onClick={() => selectTool(id)} aria-pressed={selectedTool === id} disabled={autoLocked}>
                  <span className="tool-name"><span className="tool-icon"><Icon size={14}/></span>{getToolName(id)}</span><span className="tool-state">{selectedTool === id ? 'MOUNTED' : requiredTool === id ? 'REQUIRED' : 'STOWED'}</span>
                </button>)}
              </div>
              <div className="micro-label" style={{ marginTop: 7 }}>Selecting a tool changes the end-effector geometry and operation readiness.</div>
              <div className="control-group">
                <div className="control-head"><span className="micro-label">Camera / tracking view</span><span className="micro-label">{cameraLabel.toUpperCase()}</span></div>
                <div className="camera-row">{cameraModes.map((mode) => <button key={mode.id} className={`camera-button ${cameraMode === mode.id ? 'active' : ''}`} data-testid={mode.testId} onClick={() => setCamera(mode.id)} aria-pressed={cameraMode === mode.id} disabled={autoLocked}>{mode.label}</button>)}</div>
              </div>
              <div className="control-group">
                <div className="control-head"><label htmlFor="grip-range" className="micro-label">Safe-grip force</label><span className="micro-label">{gripForce}%{gripWindow ? ` · ${gripWindow[0]}–${gripWindow[1]}%` : ''}</span></div>
                <input id="grip-range" aria-label="Safe-grip force" data-testid="input-grip-force" type="range" min="0" max="100" value={gripForce} disabled={mode === 'autonomous'} onChange={(event) => updateGrip(Number(event.target.value))}/>
              </div>
              <div className="control-group">
                <div className="control-head"><label htmlFor="zoom-range" className="micro-label">Scene magnification</label><span className="micro-label">{zoom.toFixed(1)}×</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><ZoomOut size={13} color="#7e9ba5"/><input id="zoom-range" aria-label="Scene zoom" data-testid="input-zoom" type="range" min="1" max="2.8" step=".1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}/><ZoomIn size={13} color="#7e9ba5"/></div>
              </div>
              <div className="telemetry-inline">
                <div className="metric"><label>Shoulder angle</label><strong data-testid="value-shoulder-angle-readout">{angles.shoulderDeg.toFixed(1)}°</strong></div>
                <div className="metric"><label>Elbow angle</label><strong data-testid="value-elbow-angle-readout">{angles.elbowDeg.toFixed(1)}°</strong></div>
              </div>
            </section>
          </aside>
        </div>
        <section className="panel log-panel">
          <div className="panel-head"><span>Operation log / mission clock</span><span className="head-right"><Crosshair size={11}/> SEQUENCE RECORD · {log.length} EVENTS</span></div>
          <div className="log-list" aria-live="polite" data-testid="list-operation-log">
            {log.map((entry, index) => <div className={`log-entry ${entry.warn ? 'warn' : ''}`} key={`${entry.time}-${index}`} data-testid={`log-entry-${index}`}><span className="log-time">{entry.time}</span><span className="log-mark">{entry.warn ? '!' : '›'}</span><span>{entry.message}</span></div>)}
          </div>
        </section>
        <div className="footer-note"><span><ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 5 }}/>Educational orbital servicing simulation inspired by RRM.</span><span>Measurements, mechanics, timing and fluid transfer are simplified; this is not NASA software or flight telemetry.</span></div>
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
