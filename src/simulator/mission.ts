import type { AlignmentMeasurement } from './kinematics';

export type ToolId =
  | 'wire-blanket'
  | 'cap-removal'
  | 'multifunction'
  | 'nozzle';

export type CameraMode = 'overview' | 'wrist' | 'worksite';

export type MissionStage =
  | 'inspection'
  | 'wire-clearance'
  | 'cap-removal'
  | 'valve-access'
  | 'nozzle-connection'
  | 'transfer'
  | 'valve-closure'
  | 'disconnect'
  | 'verification'
  | 'complete';

export interface MissionState {
  stage: MissionStage;
  wiresCut: boolean;
  blanketCleared: boolean;
  capRemoved: boolean;
  valveAccessed: boolean;
  nozzleConnected: boolean;
  valveOpen: boolean;
  transferActive: boolean;
  transferPercent: number;
  verified: boolean;
}

export interface MissionInput {
  tool: ToolId | null;
  cameraMode: CameraMode;
  alignment: AlignmentMeasurement;
  gripForce: number;
}

export interface MissionResult {
  state: MissionState;
  event?: string;
  warning?: string;
}

export const MISSION_STEPS: ReadonlyArray<{
  id: Exclude<MissionStage, 'complete'>;
  label: string;
}> = [
  { id: 'inspection', label: 'Inspect module' },
  { id: 'wire-clearance', label: 'Wires & blanket' },
  { id: 'cap-removal', label: 'Remove safety cap' },
  { id: 'valve-access', label: 'Access fuel valve' },
  { id: 'nozzle-connection', label: 'Align & connect' },
  { id: 'transfer', label: 'Transfer ethanol' },
  { id: 'valve-closure', label: 'Close valve' },
  { id: 'disconnect', label: 'Disconnect nozzle' },
  { id: 'verification', label: 'Verify & report' },
];

export const TANK_CAPACITY_LITERS = 12;
export const SIMULATED_TRANSFER_RATE_LPS = 1.2;

export function createInitialMissionState(): MissionState {
  return {
    stage: 'inspection',
    wiresCut: false,
    blanketCleared: false,
    capRemoved: false,
    valveAccessed: false,
    nozzleConnected: false,
    valveOpen: false,
    transferActive: false,
    transferPercent: 0,
    verified: false,
  };
}

const toolByStage: Partial<Record<MissionStage, ToolId>> = {
  'wire-clearance': 'wire-blanket',
  'cap-removal': 'cap-removal',
  'valve-access': 'multifunction',
  'nozzle-connection': 'nozzle',
  transfer: 'multifunction',
  'valve-closure': 'multifunction',
  disconnect: 'nozzle',
};

const toolNames: Record<ToolId, string> = {
  'wire-blanket': 'Wire Cutter + Blanket Manipulation Tool',
  'cap-removal': 'Safety Cap Removal Tool',
  multifunction: 'Multifunction Tool',
  nozzle: 'Nozzle Tool',
};

const gripWindowByStage: Partial<Record<MissionStage, readonly [number, number]>> = {
  'wire-clearance': [35, 70],
  'cap-removal': [25, 65],
  'valve-access': [30, 70],
  'nozzle-connection': [35, 65],
  transfer: [30, 70],
  'valve-closure': [30, 70],
  disconnect: [35, 65],
};

export function getRequiredTool(stage: MissionStage): ToolId | null {
  return toolByStage[stage] ?? null;
}

export function getToolName(tool: ToolId): string {
  return toolNames[tool];
}

export function getGripWindow(stage: MissionStage): readonly [number, number] | null {
  return gripWindowByStage[stage] ?? null;
}

export function isToolAvailable(tool: ToolId, stage: MissionStage): boolean {
  return getRequiredTool(stage) === tool;
}

function warning(state: MissionState, message: string): MissionResult {
  return { state, warning: message };
}

function checkTool(
  state: MissionState,
  input: MissionInput,
  required: ToolId,
): MissionResult | null {
  if (!input.tool) return warning(state, 'Select a servicing tool before continuing.');
  if (!isToolAvailable(input.tool, state.stage)) {
    return warning(
      state,
      `${getToolName(input.tool)} is stowed for this operation. Use the ${getToolName(required)}.`,
    );
  }
  if (input.tool !== required) {
    return warning(state, `Wrong tool. Select the ${getToolName(required)}.`);
  }
  return null;
}

function checkPositionAndGrip(
  state: MissionState,
  input: MissionInput,
): MissionResult | null {
  if (!input.alignment.withinTolerance) {
    return warning(
      state,
      `Target is ${Math.round(input.alignment.distance)} px away. Move the arm inside the ${input.alignment.tolerance}px capture tolerance.`,
    );
  }
  const safeGrip = getGripWindow(state.stage);
  if (!safeGrip) {
    return warning(state, 'No safe-grip window is defined for the current operation.');
  }
  if (input.gripForce < safeGrip[0] || input.gripForce > safeGrip[1]) {
    return warning(
      state,
      `Grip setting ${Math.round(input.gripForce)}% is outside the safe ${safeGrip[0]}–${safeGrip[1]}% window.`,
    );
  }
  return null;
}

export function attemptMissionOperation(
  state: MissionState,
  input: MissionInput,
): MissionResult {
  if (state.stage === 'complete') {
    return warning(state, 'Mission complete. Reset the simulator to run it again.');
  }

  if (state.stage === 'inspection') {
    if (input.cameraMode === 'overview') {
      return warning(
        state,
        'Inspection needs a focused camera view. Select Wrist Camera or Worksite Close-Up.',
      );
    }
    return {
      state: { ...state, stage: 'wire-clearance' },
      event: 'Worksite inspected; retaining wires, blanket edge, and fuel port identified.',
    };
  }

  const requiredTool = getRequiredTool(state.stage);
  if (requiredTool) {
    const toolError = checkTool(state, input, requiredTool);
    if (toolError) return toolError;
  }

  if (state.stage === 'wire-clearance') {
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: {
        ...state,
        stage: 'cap-removal',
        wiresCut: true,
        blanketCleared: true,
      },
      event: 'Retaining wires cut; thermal blanket flap moved clear of the service port.',
    };
  }

  if (state.stage === 'cap-removal') {
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, stage: 'valve-access', capRemoved: true },
      event: 'Protective fuel cap removed and secured in the tool bay.',
    };
  }

  if (state.stage === 'valve-access') {
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, stage: 'nozzle-connection', valveAccessed: true },
      event: 'Multifunction Tool opened the valve guard; fuel interface is exposed.',
    };
  }

  if (state.stage === 'nozzle-connection') {
    if (!state.valveAccessed) {
      return warning(state, 'Access the fuel valve with the Multifunction Tool first.');
    }
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, stage: 'transfer', nozzleConnected: true },
      event: 'Nozzle aligned and captured; connection seal check passed.',
    };
  }

  if (state.stage === 'transfer') {
    if (state.transferActive) {
      return warning(state, 'Transfer is already running. Pause or wait for the tank target.');
    }
    if (!state.nozzleConnected) {
      return warning(state, 'Connect and seal the Nozzle Tool before opening the valve.');
    }
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, valveOpen: true, transferActive: true },
      event: 'Fuel valve opened; illustrative ethanol transfer started.',
    };
  }

  if (state.stage === 'valve-closure') {
    if (state.transferPercent < 100) {
      return warning(state, 'Allow the receiving tank to reach its target before closing the valve.');
    }
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, stage: 'disconnect', valveOpen: false },
      event: 'Fuel valve closed; pressure equalization confirmed.',
    };
  }

  if (state.stage === 'disconnect') {
    if (state.valveOpen) {
      return warning(state, 'Close the fuel valve before disconnecting the nozzle.');
    }
    const positionError = checkPositionAndGrip(state, input);
    if (positionError) return positionError;
    return {
      state: { ...state, stage: 'verification', nozzleConnected: false },
      event: 'Nozzle disconnected and stowed clear of the fuel port.',
    };
  }

  if (state.stage === 'verification') {
    if (input.cameraMode !== 'worksite') {
      return warning(
        state,
        'Verification needs the Worksite Close-Up camera to confirm the closed valve and tank.',
      );
    }
    if (state.valveOpen || state.nozzleConnected || state.transferPercent < 100) {
      return warning(state, 'Verification failed. Confirm the valve is closed and the nozzle is disconnected.');
    }
    return {
      state: { ...state, stage: 'complete', verified: true },
      event: `Transfer verified: ${state.transferPercent}% of illustrative tank capacity received.`,
    };
  }

  return warning(state, 'This operation is not available in the current mission stage.');
}

export function advanceTransfer(
  state: MissionState,
  percentStep = 2,
): MissionState {
  if (state.stage !== 'transfer' || !state.valveOpen || !state.transferActive) {
    return state;
  }

  const transferPercent = Math.min(100, state.transferPercent + percentStep);
  const complete = transferPercent >= 100;
  return {
    ...state,
    transferPercent,
    transferActive: !complete,
    stage: complete ? 'valve-closure' : 'transfer',
  };
}
