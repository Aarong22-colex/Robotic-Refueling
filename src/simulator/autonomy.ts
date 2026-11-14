import {
  getGripWindow,
  getRequiredTool,
  type CameraMode,
  type MissionState,
  type MissionStage,
  type ToolId,
} from './mission.ts';
import { targetForStage, type Point } from './kinematics.ts';

export type OperatingMode = 'manual' | 'assisted' | 'autonomous';

export interface AutonomousInstruction {
  stage: MissionStage;
  target: Point;
  tool: ToolId | null;
  cameraMode: CameraMode;
  gripForce: number;
}

export function planAutonomousInstruction(
  mission: MissionState,
): AutonomousInstruction | null {
  if (mission.stage === 'complete') return null;
  const gripWindow = getGripWindow(mission.stage);
  const gripForce = gripWindow
    ? (gripWindow[0] + gripWindow[1]) / 2
    : 50;

  return {
    stage: mission.stage,
    target: targetForStage(mission.stage),
    tool: getRequiredTool(mission.stage),
    cameraMode: 'worksite',
    gripForce,
  };
}
