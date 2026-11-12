import type { MissionStage } from './mission';

export interface Point {
  x: number;
  y: number;
}

export interface JointAngles {
  shoulderDeg: number;
  elbowDeg: number;
}

export interface ArmPose {
  base: Point;
  elbow: Point;
  endEffector: Point;
  toolAngleDeg: number;
}

export interface AlignmentMeasurement {
  distance: number;
  tolerance: number;
  alignmentPercent: number;
  withinTolerance: boolean;
}

export const ARM_GEOMETRY = {
  base: { x: 150, y: 500 },
  upperArmLength: 390,
  forearmLength: 360,
  captureTolerance: 18,
} as const;

export const WORKSITE_TARGETS: Record<string, Point> = {
  survey: { x: 840, y: 240 },
  wires: { x: 812, y: 310 },
  cap: { x: 838, y: 292 },
  valve: { x: 840, y: 290 },
  nozzle: { x: 840, y: 290 },
  disconnect: { x: 840, y: 290 },
  verify: { x: 840, y: 290 },
};

const targetNameByStage: Record<MissionStage, keyof typeof WORKSITE_TARGETS> = {
  inspection: 'survey',
  'wire-clearance': 'wires',
  'cap-removal': 'cap',
  'valve-access': 'valve',
  'nozzle-connection': 'nozzle',
  transfer: 'valve',
  'valve-closure': 'valve',
  disconnect: 'disconnect',
  verification: 'verify',
  complete: 'verify',
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function targetForStage(stage: MissionStage): Point {
  return WORKSITE_TARGETS[targetNameByStage[stage]];
}

export function forwardKinematics(
  angles: JointAngles,
  geometry = ARM_GEOMETRY,
): ArmPose {
  const shoulder = toRadians(angles.shoulderDeg);
  const elbow = toRadians(angles.shoulderDeg + angles.elbowDeg);
  const elbowPoint = {
    x: geometry.base.x + geometry.upperArmLength * Math.cos(shoulder),
    y: geometry.base.y + geometry.upperArmLength * Math.sin(shoulder),
  };
  const endEffector = {
    x: elbowPoint.x + geometry.forearmLength * Math.cos(elbow),
    y: elbowPoint.y + geometry.forearmLength * Math.sin(elbow),
  };

  return {
    base: geometry.base,
    elbow: elbowPoint,
    endEffector,
    toolAngleDeg: angles.shoulderDeg + angles.elbowDeg,
  };
}

export function solveInverseKinematics(
  target: Point,
  geometry = ARM_GEOMETRY,
  elbowDirection: 1 | -1 = 1,
): JointAngles {
  const dx = target.x - geometry.base.x;
  const dy = target.y - geometry.base.y;
  const distanceSquared = dx * dx + dy * dy;
  const { upperArmLength: upper, forearmLength: forearm } = geometry;
  const cosineElbow = clamp(
    (distanceSquared - upper * upper - forearm * forearm) /
      (2 * upper * forearm),
    -1,
    1,
  );
  const elbow = Math.acos(cosineElbow) * elbowDirection;
  const shoulder =
    Math.atan2(dy, dx) -
    Math.atan2(forearm * Math.sin(elbow), upper + forearm * Math.cos(elbow));

  return {
    shoulderDeg: toDegrees(shoulder),
    elbowDeg: toDegrees(elbow),
  };
}

export function measureAlignment(
  position: Point,
  target: Point,
  tolerance = ARM_GEOMETRY.captureTolerance,
): AlignmentMeasurement {
  const distance = Math.hypot(position.x - target.x, position.y - target.y);
  const alignmentPercent = Math.max(
    0,
    Math.round(100 - (distance / tolerance) * 10),
  );
  return {
    distance,
    tolerance,
    alignmentPercent,
    withinTolerance: distance <= tolerance,
  };
}
