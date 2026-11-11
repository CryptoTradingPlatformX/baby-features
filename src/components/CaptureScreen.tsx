import { useEffect, useRef, useState } from "react";
import type { Angle, Person, PhotoAnalysis, StoredPhoto } from "../types";
import { hasBlockingIssue } from "../types";
import { poseLabel } from "../analysis/pose";
import { featureMeta } from "../types";
import { canvasToBlob } from "../vision/imageutil";
import type { ModelProgress } from "../vision/engine";
import { CropImage } from "./CropImage";
import { GuideOverlay } from "./GuideOverlay";

const ANGLES: Angle[] = ["front", "left", "right"];

const TITLES: Record<Angle, string> = {
  front: "Front",
  left: "Left side",
  right: "Right side",
};

interface ReviewState {
  previewUrl: string;
  blob: Blob;
  width: number;
  height: number;
  analysis: PhotoAnalysis | null;
  status: "working" | "done" | "failed";
  message: string;
}

export function CaptureScreen({
  person,
  onSave,
  onBack,
  onDone,
}: {
  person: Person;
  onSave: (person: Person) => Promise<void>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [angle, setAngle] = useState<Angle>(() => ANGLES.find((item) => !person.photos[item]) ?? "front");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [name, setName] = useState(person.name);
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || review) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream, review]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function stopCamera() {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  }

  async function startCamera(nextFacing: "environment" | "user" = facing) {
    stopCamera();
    setCameraNote(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraNote("This browser has no live camera. Take a photo or choose one from the library.");
      return;
    }
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 1600 } },
      });
      setFacing(nextFacing);
      setStream(next);
    } catch {
      setCameraNote("The camera didn't open. You can still take a photo or choose one from the library.");
    }
  }

  function rememberPreview(url: string | null) {
    if (previewRef.current && previewRef.current !== url) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
  }

  function chooseAngle(next: Angle) {
    rememberPreview(null);
    setReview(null);
    setAngle(next);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    stopCamera();
    const previewUrl = URL.createObjectURL(file);
    rememberPreview(previewUrl);
    setReview({
      previewUrl,
      blob: file,
      width: 0,
      height: 0,
      analysis: null,
      status: "working",
      message: "Looking at this photo…",
    });
    try {
      const vision = await import("../vision/analyze");
      const stop = vision.subscribeModel(setProgress);
      let canvas;
      let analysis;
      try {
        const result = await vision.analyzePhotoBlob(file, angle);
        canvas = result.canvas;
        analysis = result.analysis;
      } finally {
        stop();
        setProgress(null);
      }
      const blob = await canvasToBlob(canvas, 0.9);
      const orientedUrl = URL.createObjectURL(blob);
      rememberPreview(orientedUrl);
      setReview({
        previewUrl: orientedUrl,
        blob,
        width: canvas.width,
        height: canvas.height,
        analysis,
        status: "done",
        message: "",
      });
    } catch (error) {
      setReview({
        previewUrl,
        blob: file,
        width: 0,
        height: 0,
        analysis: null,
        status: "failed",
        message: error instanceof Error ? error.message : "Could not read that photo.",
      });
    }
  }

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) void onFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  async function commit(target: Angle, analysis: PhotoAnalysis, blob: Blob, width: number, height: number) {
    let finalAnalysis = analysis;
    let finalBlob = blob;
    if (target !== angle) {
      const vision = await import("../vision/analyze");
      const oriented = await vision.analyzePhotoBlob(blob, target);
      finalAnalysis = oriented.analysis;
      finalBlob = await canvasToBlob(oriented.canvas, 0.9);
      if (hasBlockingIssue(finalAnalysis.issues)) {
        const previewUrl = URL.createObjectURL(finalBlob);
        rememberPreview(previewUrl);
        setAngle(target);
        setReview({
          previewUrl,
          blob: finalBlob,
          width: oriented.canvas.width,
          height: oriented.canvas.height,
          analysis: finalAnalysis,
          status: "done",
          message: "",
        });
        return;
      }
      width = oriented.canvas.width;
      height = oriented.canvas.height;
    }
    const photo: StoredPhoto = {
      angle: target,
      blob: finalBlob,
      width,
      height,
      createdAt: Date.now(),
      analysis: finalAnalysis,
    };
    const next: Person = { ...person, name: name.trim() || person.name, photos: { ...person.photos, [target]: photo } };
    await onSave(next);
    const index = ANGLES.indexOf(target);
    const missingLater = ANGLES.slice(index + 1).find((item) => !next.photos[item]);
    const missingEarlier = ANGLES.slice(0, index).find((item) => !next.photos[item]);
    rememberPreview(null);
    setReview(null);
    if (missingLater) setAngle(missingLater);
    else if (missingEarlier && next.kind === "baby") setAngle(missingEarlier);
    else onDone();
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === person.name) return;
    await onSave({ ...person, name: trimmed });
  }

  const who = person.kind === "baby" ? name || "baby" : name || "them";
  const blocking = review?.analysis ? hasBlockingIssue(review.analysis.issues) : false;
  const otherSide =
    review?.analysis && (review.analysis.pose.kind === "left" || review.analysis.pose.kind === "right")
      ? review.analysis.pose.kind
      : null;

  return (
    <section className="screen">
      <header className="top">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <p className="eyebrow">{person.kind === "baby" ? "Your baby" : person.relationship}</p>
          <h1>{TITLES[angle]}</h1>
        </div>
        <button className="text-btn" type="button" onClick={onDone}>
          Done
        </button>
      </header>

      {person.kind === "baby" ? (
        <label className="name-row">
          Name
          <input
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void saveName()}
          />
        </label>
      ) : null}

      <div className="steps" role="tablist">
        {ANGLES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === angle ? "step active" : "step"}
            data-testid={`step-${item}`}
            onClick={() => chooseAngle(item)}
          >
            <span>{TITLES[item]}</span>
            <small>{person.photos[item] ? "Saved" : "Needed"}</small>
          </button>
        ))}
      </div>

      <div className="stage">
        {review ? (
          <img src={review.previewUrl} alt={`${TITLES[angle]} photo preview`} />
        ) : stream ? (
          <video ref={videoRef} playsInline autoPlay muted />
        ) : (
          <div className="stage-empty" />
        )}
        {review ? null : <GuideOverlay angle={angle} />}
      </div>

      <ul className="tips">
        {tips(angle, who).map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>

      {progress && progress.ratio > 0 && progress.ratio < 1 ? (
        <div className="progress" role="status">
          <div className="progress-bar" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          <span>
            {progress.label} {Math.round(progress.ratio * 100)}%
          </span>
        </div>
      ) : null}

      {cameraNote ? <p className="note">{cameraNote}</p> : null}

      {review?.status === "working" ? (
        <p className="status" role="status">
          {review.message}
        </p>
      ) : null}
      {review?.status === "failed" ? <p className="issue error">{review.message}</p> : null}

      {review?.analysis ? (
        <div
          data-testid="review"
          data-pose={review.analysis.pose.kind}
          data-turned={review.analysis.pose.turned.toFixed(3)}
          data-sharpness={review.analysis.sharpness.toFixed(1)}
          data-brightness={review.analysis.brightness.toFixed(2)}
          data-features={review.analysis.features.map((feature) => feature.id).join(",")}
        >
          <p className="pose-label">{poseLabel(review.analysis.pose)}</p>
          <div className="issues">
            {review.analysis.issues.map((issue) => (
              <p key={issue.code + issue.message} className={issue.severity === "error" ? "issue error" : "issue"}>
                {issue.message}
              </p>
            ))}
          </div>
          {review.analysis.features.length ? (
            <div className="mini-row">
              {review.analysis.features.map((feature) => (
                <figure key={feature.id} data-testid={`review-${feature.id}`}>
                  <CropImage blob={feature.cropBlob} alt={feature.friendly} />
                  <figcaption>{featureMeta(feature.id).label}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="actions">
        {review ? (
          <>
            <button className="btn secondary" type="button" data-testid="retake" onClick={() => chooseAngle(angle)}>
              Retake
            </button>
            <button
              className="btn"
              type="button"
              data-testid="use-photo"
              disabled={review.status !== "done" || !review.analysis || blocking}
              onClick={() => {
                if (review.analysis) void commit(angle, review.analysis, review.blob, review.width, review.height);
              }}
            >
              Use this photo
            </button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={() => cameraRef.current?.click()}>
              Take photo
            </button>
            <button className="btn secondary" type="button" data-testid="open-library" onClick={() => fileRef.current?.click()}>
              Photo library
            </button>
          </>
        )}
      </div>

      {review?.analysis && blocking && otherSide && otherSide !== angle ? (
        <button
          className="btn secondary wide"
          type="button"
          onClick={() => {
            if (review.analysis) void commit(otherSide, review.analysis, review.blob, review.width, review.height);
          }}
        >
          Use as the {otherSide} side instead
        </button>
      ) : null}

      {!review ? (
        <div className="actions subtle">
          {stream ? (
            <>
              <button className="btn secondary" type="button" onClick={snap}>
                Shutter
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => void startCamera(facing === "environment" ? "user" : "environment")}
              >
                Flip camera
              </button>
            </>
          ) : (
            <button className="btn secondary" type="button" onClick={() => void startCamera("environment")}>
              Live camera
            </button>
          )}
          {person.kind === "family" && !person.photos[angle] ? (
            <button
              className="btn ghost"
              type="button"
              data-testid="skip-angle"
              onClick={() => {
                const index = ANGLES.indexOf(angle);
                const next = ANGLES[index + 1];
                if (next) setAngle(next);
                else onDone();
              }}
            >
              Skip this angle
            </button>
          ) : null}
        </div>
      ) : null}

      <input
        ref={fileRef}
        data-testid="file-input"
        className="hidden-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file);
        }}
      />
      <input
        ref={cameraRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file);
        }}
      />
      <p className="privacy">Photos stay on this phone. Nothing is uploaded.</p>
    </section>
  );
}

function tips(angle: Angle, who: string): string[] {
  if (angle === "front") {
    return [
      "Soft, even light. Face a window rather than standing in front of it.",
      `A calm face from ${who}, eyes open, mouth relaxed.`,
      "Hair and hats off the forehead if you can.",
    ];
  }
  const side = angle === "left" ? "left" : "right";
  return [
    `Turn until ${who}'s ${side} ear is fully in view.`,
    "Tuck hair behind the ear.",
    "Keep the nose and the back of the ear in the photo.",
  ];
}
