import type { Angle, Issue, PoseEstimate } from "../types";
import { clamp } from "./math";

export interface PoseSignals {
  eyeRatio: number;
  widerSide: "left" | "right";
  widthRatio: number;
  rollDeg: number;
}

/** 0 is straight-on, 1 is a full side view. Uses foreshortening, not raw pixel size. */
export function turnAmount(signals: PoseSignals): number {
  const fromEyes = clamp((0.92 - signals.eyeRatio) / 0.55, 0, 1);
  const fromWidth = clamp((0.84 - signals.widthRatio) / 0.38, 0, 1);
  return fromEyes * 0.7 + fromWidth * 0.3;
}

export function classifyPose(signals: PoseSignals): PoseEstimate {
  const turned = turnAmount(signals);
  let kind: PoseEstimate["kind"] = "unknown";
  if (Number.isFinite(signals.eyeRatio) && signals.eyeRatio > 0.05 && signals.widthRatio > 0.15) {
    // 0.47 is a true side or a deep three-quarter with the ear in view.
    // Shallower turns stay "three-quarter" and ask for a retake.
    if (turned < 0.32) kind = "front";
    else if (turned < 0.47) kind = "three-quarter";
    else kind = signals.widerSide;
  }
  return {
    kind,
    widerSide: signals.widerSide,
    turned,
    rollDeg: signals.rollDeg,
    eyeRatio: signals.eyeRatio,
    widthRatio: signals.widthRatio,
  };
}

export function poseIssues(expected: Angle, pose: PoseEstimate): Issue[] {
  const issues: Issue[] = [];
  if (pose.kind === "unknown") {
    issues.push({
      severity: "error",
      code: "pose-unknown",
      message: "We couldn't tell which way the head is turned. Move closer and retake.",
    });
    return issues;
  }

  if (expected === "front") {
    if (pose.kind === "left" || pose.kind === "right") {
      issues.push({
        severity: "error",
        code: "not-front",
        message: "This looks like a side view. For the front photo, have the face look straight at the camera.",
      });
    } else if (pose.kind === "three-quarter") {
      issues.push({
        severity: "error",
        code: "not-front",
        message: "The head is turned too far. Face the camera more straight on, with both cheeks visible.",
      });
    } else if (Math.abs(pose.rollDeg) > 35) {
      issues.push({
        severity: "error",
        code: "rolled",
        message: "The photo is sideways. Rotate it so the eyes are level.",
      });
    } else if (Math.abs(pose.rollDeg) > 18) {
      issues.push({
        severity: "warn",
        code: "rolled",
        message: "Tilt the camera a little so the eyes sit level.",
      });
    }
    return issues;
  }

  if (pose.kind === "front") {
    issues.push({
      severity: "error",
      code: "not-profile",
      message: "This looks straight-on, not a side view. Turn until the whole ear is visible.",
    });
  } else if (pose.kind === "three-quarter") {
    issues.push({
      severity: "error",
      code: "not-profile",
      message: "Turn a little more to the side so the whole ear is in the frame, hair pulled back.",
    });
  } else if (pose.kind !== expected) {
    const seen = pose.kind === "left" ? "left" : "right";
    issues.push({
      severity: "error",
      code: "wrong-side",
      message: `This shows the ${seen} side. Turn the other way so the ${expected} ear faces the camera.`,
    });
  } else if (pose.turned < 0.62) {
    issues.push({
      severity: "warn",
      code: "shallow-profile",
      message: "A little more of a turn would show the ear more clearly.",
    });
  }

  return issues;
}

export function poseLabel(pose: PoseEstimate): string {
  if (pose.kind === "front") return "Straight-on face";
  if (pose.kind === "left") return "Left side";
  if (pose.kind === "right") return "Right side";
  if (pose.kind === "three-quarter") return "Partly turned";
  return "Head angle unclear";
}
