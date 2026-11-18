# NASA RRM Robotic Refueling Simulator

An interactive engineering simulation inspired by NASA's Robotic Refueling Mission (RRM), exploring robotic manipulation, satellite servicing, inverse kinematics, and autonomous operations.

<p align="center">
  <a href="https://aarong22-colex.github.io/Robotic-Refueling/">
    <strong>LAUNCH INTERACTIVE SIMULATOR →</strong>
  </a>
</p>

## Project Overview

What if satellites could be repaired and refuelled instead of replaced?

Spacecraft can remain operational even after running out of the propellant needed to perform essential manoeuvres. Robotic servicing offers a potential way to extend spacecraft lifetimes by allowing robots to inspect, maintain, and refuel equipment in orbit.

This project recreates a simplified version of NASA's Robotic Refueling Mission as an interactive browser-based simulator.

Users can operate a robotic manipulator, interact with simulated spacecraft servicing hardware, and complete a multi-stage refuelling procedure while exploring the robotics concepts behind the operation.

## Key Features

### Robotic Manipulation
- Interactive two-joint robotic arm.
- Shoulder and elbow joint controls.
- Animated end-effector movement.
- Simulated spacecraft servicing tools.
- Target positioning and alignment.

### Robotics and Kinematics
- **Forward kinematics:** Calculates end-effector coordinates from joint angles.
- **Inverse kinematics:** Calculates the joint angles required to reach a target.
- Target reachability checks.
- Joint-angle constraints.
- Smooth interpolation between joint positions.

### Three Operating Modes

**Manual Mode**
- Direct control of the robotic arm through joint-angle sliders.
- User-controlled positioning and movement.

**Assisted Mode**
- Users select a target position in the workspace.
- The system calculates the required joint angles using inverse kinematics.
- Users confirm movements before execution.

**Autonomous Mode**
- Executes the programmed refuelling mission sequence.
- Coordinates simulated robotic movements and tool selection.
- Includes pause, resume, and stop controls.

### Nine-Stage Mission Simulation

1. Worksite inspection
2. Retaining wire removal
3. Safety cap removal
4. Fuel valve access
5. Nozzle alignment and connection
6. Simulated fuel transfer
7. Valve closure
8. Nozzle disconnection
9. Final verification

### Mission Control
- Robotic arm telemetry.
- Joint-angle and target-position information.
- Alignment feedback.
- Tool selection and status.
- Mission progress tracking.
- Operation logs and status indicators.

## Engineering Concepts

### Forward Kinematics

Forward kinematics calculates the end-effector position using the robotic arm's joint angles and link lengths.

For a simplified two-link planar manipulator:

```text
x = L1*cos(theta1) + L2*cos(theta1 + theta2)

y = L1*sin(theta1) + L2*sin(theta1 + theta2)
```

### Inverse Kinematics

Inverse kinematics solves the reverse problem by calculating the joint angles required to position the end effector at a selected target.

The simulator uses this calculation in assisted operation, allowing users to select a target rather than manually determining the required joint angles.

## Technology Stack

- React
- TypeScript
- HTML
- CSS
- Vite

## Project Scope and Limitations

This is an independent educational simulation inspired by NASA's Robotic Refueling Mission.

It is not official NASA software, a NASA-developed product, or a physically accurate digital twin of Dextre or the RRM hardware.

The robotic manipulator uses a simplified two-dimensional model. The simulator does not fully reproduce orbital mechanics, microgravity, real fluid dynamics, spacecraft hardware forces, or flight-qualified autonomous control systems.

Its purpose is to demonstrate core robotics principles and provide an interactive representation of a complex space-servicing procedure.

## Background and References

- [NASA – Robotic Refueling Mission](https://www.nasa.gov/isam/rrm-1-2/)
- [NASA – Robotic Refueling Mission Phase 1](https://www.nasa.gov/nexis/rrm-phase-1/)
- [Canadian Space Agency – Dextre](https://www.asc-csa.gc.ca/eng/iss/dextre/)

## Live Demonstration

**[Launch the Interactive NASA RRM Simulator](https://aarong22-colex.github.io/Robotic-Refueling/)**

Explore the robotic manipulator, experiment with inverse kinematics, switch between manual, assisted, and autonomous modes, and complete the simulated refuelling mission.

---

*An independent engineering and technology project exploring robotic satellite servicing and in-space maintenance.*
