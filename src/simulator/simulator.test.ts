import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attemptMissionOperation,
  advanceTransfer,
  createInitialMissionState,
  SIMULATED_TRANSFER_RATE_LPS,
  TANK_CAPACITY_LITERS,
} from './mission.ts';
import {
  ARM_GEOMETRY,
  forwardKinematics,
  measureAlignment,
  solveInverseKinematics,
  targetForStage,
} from './kinematics.ts';

const aligned = {
  distance: 0,
  tolerance: ARM_GEOMETRY.captureTolerance,
  alignmentPercent: 100,
  withinTolerance: true,
};

function runOperation(
  state: ReturnType<typeof createInitialMissionState>,
  tool: Parameters<typeof attemptMissionOperation>[1]['tool'],
  cameraMode: Parameters<typeof attemptMissionOperation>[1]['cameraMode'] = 'overview',
  gripForce = 50,
) {
  return attemptMissionOperation(state, {
    tool,
    cameraMode,
    alignment: aligned,
    gripForce,
  });
}

test('forward kinematics and inverse solve agree at the valve target', () => {
  const target = targetForStage('valve-access');
  const angles = solveInverseKinematics(target);
  const pose = forwardKinematics(angles);
  const alignment = measureAlignment(pose.endEffector, target);

  assert.ok(alignment.withinTolerance);
  assert.ok(alignment.distance < 1);
});

test('alignment reports a miss outside the capture tolerance', () => {
  const measurement = measureAlignment({ x: 0, y: 0 }, { x: 30, y: 0 });
  assert.equal(measurement.withinTolerance, false);
  assert.ok(measurement.alignmentPercent < 90);
});

test('wrong tool, unsafe grip, and poor alignment do not advance the mission', () => {
  const initial = createInitialMissionState();
  const inspection = runOperation(initial, null, 'worksite');
  const wrongTool = runOperation(inspection.state, 'nozzle');
  const unsafeGrip = runOperation(inspection.state, 'wire-blanket', 'overview', 95);
  const poorPosition = attemptMissionOperation(inspection.state, {
    tool: 'wire-blanket',
    cameraMode: 'overview',
    alignment: { ...aligned, distance: 44, alignmentPercent: 0, withinTolerance: false },
    gripForce: 50,
  });

  assert.equal(inspection.state.stage, 'wire-clearance');
  assert.match(wrongTool.warning ?? '', /stowed|Wrong tool/i);
  assert.match(unsafeGrip.warning ?? '', /safe 35–70% window/i);
  assert.match(poorPosition.warning ?? '', /capture tolerance/i);
  assert.equal(wrongTool.state.stage, 'wire-clearance');
  assert.equal(unsafeGrip.state.stage, 'wire-clearance');
  assert.equal(poorPosition.state.stage, 'wire-clearance');
});

test('the full mission enforces order and finishes with a verified transfer', () => {
  let state = createInitialMissionState();

  const inspectionBlocked = runOperation(state, null, 'overview');
  assert.match(inspectionBlocked.warning ?? '', /focused camera view/i);
  assert.equal(inspectionBlocked.state.stage, 'inspection');

  state = runOperation(state, null, 'wrist').state;
  state = runOperation(state, 'wire-blanket').state;
  state = runOperation(state, 'cap-removal').state;
  state = runOperation(state, 'multifunction').state;
  state = runOperation(state, 'nozzle').state;
  state = runOperation(state, 'multifunction').state;

  assert.equal(state.stage, 'transfer');
  assert.equal(state.valveOpen, true);
  assert.equal(state.nozzleConnected, true);

  for (let tick = 0; tick < 60 && state.stage === 'transfer'; tick += 1) {
    state = advanceTransfer(state, 2);
  }
  assert.equal(state.stage, 'valve-closure');
  assert.equal(state.transferPercent, 100);
  assert.equal(state.transferActive, false);

  state = runOperation(state, 'multifunction').state;
  assert.equal(state.valveOpen, false);
  assert.equal(state.stage, 'disconnect');

  state = runOperation(state, 'nozzle').state;
  assert.equal(state.nozzleConnected, false);
  assert.equal(state.stage, 'verification');

  const verificationBlocked = runOperation(state, null, 'wrist');
  assert.match(verificationBlocked.warning ?? '', /Worksite Close-Up/i);
  assert.equal(verificationBlocked.state.stage, 'verification');

  state = runOperation(state, null, 'worksite').state;
  assert.equal(state.stage, 'complete');
  assert.equal(state.verified, true);
  assert.equal(state.transferPercent * TANK_CAPACITY_LITERS / 100, TANK_CAPACITY_LITERS);
  assert.equal(SIMULATED_TRANSFER_RATE_LPS, 1.2);
});
