import type { Person } from "../types";
import { featuresById } from "../analysis/compare";
import { CropImage } from "./CropImage";

export function HomeScreen({
  baby,
  familyCount,
  onStartBaby,
  onFeatures,
  onFamily,
  onCompare,
  onRetake,
  onReset,
  onRerun,
  onExport,
  onImport,
  busy,
  persisted,
}: {
  baby: Person | null;
  familyCount: number;
  onStartBaby: () => void;
  onFeatures: () => void;
  onFamily: () => void;
  onCompare: () => void;
  onRetake: () => void;
  onReset: () => void;
  onRerun: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  busy: boolean;
  persisted: boolean | null;
}) {
  const face = baby ? featuresById(baby).get("faceShape") ?? featuresById(baby).get("eyes") : undefined;
  return (
    <section className="screen home">
      <p className="eyebrow">On this phone only</p>
      <h1>Baby Features</h1>
      <p className="lede">See which family member your baby’s ears, eyes, nose, and smile look most like.</p>
      <Hero />
      <p className="privacy">Photos stay on this phone. Face matching runs in the browser and nothing is uploaded.</p>
      {baby ? (
        <article className="card baby-card">
          <div className="baby-row">
            <span className="avatar large">{face ? <CropImage blob={face.cropBlob} alt="" /> : <span>♡</span>}</span>
            <div>
              <h2>{baby.name}</h2>
              <p>
                {count(baby)} of 3 photos · {familyCount} family {familyCount === 1 ? "member" : "members"}
              </p>
            </div>
          </div>
          <div className="actions">
            <button className="btn" type="button" onClick={onFeatures}>
              Features
            </button>
            <button className="btn secondary" type="button" onClick={onFamily}>
              Family
            </button>
          </div>
          <div className="actions">
            <button className="btn secondary" type="button" data-testid="compare" onClick={onCompare} disabled={familyCount === 0}>
              Compare
            </button>
            <button className="btn ghost" type="button" onClick={onRetake}>
              Retake
            </button>
          </div>
          <button className="btn secondary wide" type="button" data-testid="rerun" onClick={onRerun} disabled={busy}>
            Re-run comparison
          </button>
        </article>
      ) : (
        <button className="btn wide" type="button" data-testid="start-baby" onClick={onStartBaby}>
          Start with your baby
        </button>
      )}
      <div className="actions">
        <button className="btn secondary" type="button" onClick={onExport} disabled={!baby || busy}>
          Save backup
        </button>
        <label className="btn secondary file-btn">
          Restore backup
          <input
            className="hidden-input"
            data-testid="restore-backup"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImport(file);
            }}
          />
        </label>
      </div>
      <p className="note">
        {persisted
          ? "This browser was asked to keep the saved photos."
          : "Export a backup if this browser might clear site data."}
      </p>
      <p className="disclaimer">
        This measures visual resemblance, not genetics. Baby faces change a lot, so retaking photos every few months is part
        of the fun.
      </p>
      <details className="how">
        <summary>How the comparison works</summary>
        <p>
          Each feature is a share across the relatives who have that photo, not a standalone percent. Front features are
          mostly the landmark shape, lined up so size and tilt drop out, plus a lighting-normalized photo embedding. Ears
          use the side-photo outline and the same embedding. Missing angles are labeled “not enough photos.” A gap inside
          the noise is “too close to call.”
        </p>
      </details>
      {baby ? (
        <button className="text-btn danger" type="button" onClick={onReset}>
          Start over
        </button>
      ) : null}
    </section>
  );
}

function count(person: Person): number {
  return ["front", "left", "right"].filter((angle) => person.photos[angle as "front" | "left" | "right"]).length;
}

function Hero() {
  return (
    <svg className="hero" viewBox="0 0 320 180" role="img" aria-label="A simple baby face with ears, eyes, and a smile">
      <rect className="hero-card" x="0" y="0" width="320" height="180" rx="28" />
      <ellipse className="hero-blush" cx="78" cy="92" rx="16" ry="24" />
      <ellipse className="hero-blush" cx="242" cy="92" rx="16" ry="24" />
      <ellipse className="hero-skin" cx="160" cy="96" rx="70" ry="62" />
      <ellipse className="hero-eye" cx="134" cy="90" rx="10" ry="12" />
      <ellipse className="hero-eye" cx="186" cy="90" rx="10" ry="12" />
      <circle className="hero-pupil" cx="136" cy="92" r="5" />
      <circle className="hero-pupil" cx="188" cy="92" r="5" />
      <path className="hero-smile" d="M148 118 q12 12 24 0" fill="none" strokeWidth="3" strokeLinecap="round" />
      <circle className="hero-cheek" cx="122" cy="110" r="7" opacity="0.7" />
      <circle className="hero-cheek" cx="198" cy="110" r="7" opacity="0.7" />
    </svg>
  );
}
