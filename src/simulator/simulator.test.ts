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
  interpolateJointAngles,
  isJointAngleWithinLimits,
  measureAlignment,
  solveReachableTarget,
  solveInverseKinematics,
  targetForStage,
} from './kinematics.ts';
import { planAutonomousInstruction } from './autonomy.ts';

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

test('constrained inverse kinematics solves every mission target within joint limits', () => {
  const stages = [
    'inspection',
    'wire-clearance',
    'cap-removal',
    'valve-access',
    'nozzle-connection',
    'transfer',
    'valve-closure',
    'disconnect',
    'verification',
  ] as const;

  for (const stage of stages) {
    const target = targetForStage(stage);
    const result = solveReachableTarget(target);
    assert.equal(result.reachable, true, `${stage} target should be reachable`);
    if (!result.reachable) continue;
    assert.equal(isJointAngleWithinLimits(result.angles), true);
    assert.ok(measureAlignment(forwardKinematics(result.angles).endEffector, target).distance < 1);
  }
});

test('unreachable targets and targets blocked by joint limits report clear reasons', () => {
  const outsideWorkspace = solveReachableTarget({ x: 1000, y: 0 });
  const outsideJointLimits = solveReachableTarget({ x: 150, y: 680 });

  assert.equal(outsideWorkspace.reachable, false);
  if (!outsideWorkspace.reachable) assert.match(outsideWorkspace.reason, /reachable workspace/i);
  assert.equal(outsideJointLimits.reachable, false);
  if (!outsideJointLimits.reachable) assert.match(outsideJointLimits.reason, /joint limits/i);
  assert.equal(isJointAngleWithinLimits({ shoulderDeg: 0, elbowDeg: 180 }), false);
});

test('joint interpolation eases between manual and assisted poses', () => {
  const start = { shoulderDeg: -30, elbowDeg: 20 };
  const end = { shoulderDeg: 50, elbowDeg: 100 };

  assert.deepEqual(interpolateJointAngles(start, end, 0), start);
  assert.deepEqual(interpolateJointAngles(start, end, 1), end);
  const middle = interpolateJointAngles(start, end, 0.5);
  assert.equal(middle.shoulderDeg, 10);
  assert.equal(middle.elbowDeg, 60);
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

test('autonomous instructions follow the shared mission stage, tool, target, and grip rules', () => {
  let state = createInitialMissionState();
  const inspection = planAutonomousInstruction(state);
  assert.equal(inspection?.stage, 'inspection');
  assert.equal(inspection?.cameraMode, 'worksite');

  state = { ...state, stage: 'wire-clearance' };
  const wireStep = planAutonomousInstruction(state);
  assert.equal(wireStep?.tool, 'wire-blanket');
  assert.deepEqual(wireStep?.target, targetForStage('wire-clearance'));
  assert.ok(wireStep?.gripForce && wireStep.gripForce >= 35 && wireStep.gripForce <= 70);

  assert.equal(planAutonomousInstruction({ ...state, stage: 'complete' }), null);
});
