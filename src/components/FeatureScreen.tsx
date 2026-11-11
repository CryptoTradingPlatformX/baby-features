import { useEffect, useState } from "react";
import { FEATURES, type Person } from "../types";
import { ANALYSIS_VERSION } from "../types";
import { babyNeed } from "../analysis/compare";
import { featuresById } from "../analysis/compare";
import { canvasToBlob } from "../vision/imageutil";
import { CropImage } from "./CropImage";

export function FeatureScreen({
  person,
  onSave,
  onBack,
  onRetake,
  onAddFamily,
}: {
  person: Person;
  onSave: (person: Person) => Promise<void>;
  onBack: () => void;
  onRetake: () => void;
  onAddFamily: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const stale = (["front", "left", "right"] as const).some((angle) => {
      const photo = person.photos[angle];
      return photo && photo.analysis && photo.analysis.version !== ANALYSIS_VERSION;
    });
    if (!stale) return;
    let cancel = false;
    setBusy(true);
    setNote("Updating measurements…");
    void (async () => {
      let next = person;
      for (const angle of ["front", "left", "right"] as const) {
        const photo = next.photos[angle];
        if (!photo?.analysis || photo.analysis.version === ANALYSIS_VERSION) continue;
        const vision = await import("../vision/analyze");
        const { canvas, analysis } = await vision.analyzePhotoBlob(photo.blob, angle);
        const blob = await canvasToBlob(canvas, 0.9);
        next = {
          ...next,
          photos: { ...next.photos, [angle]: { ...photo, blob, width: canvas.width, height: canvas.height, analysis } },
        };
      }
      if (!cancel) {
        await onSave(next);
        setBusy(false);
        setNote(null);
      }
    })().catch(() => {
      if (!cancel) {
        setBusy(false);
        setNote("Could not refresh the measurements. The saved ones are still here.");
      }
    });
    return () => {
      cancel = true;
    };
  }, [person, onSave]);

  const found = featuresById(person);

  return (
    <section className="screen" data-testid="feature-list">
      <header className="top">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <p className="eyebrow">{person.name}</p>
          <h1>Features we found</h1>
        </div>
      </header>
      <p className="lede">
        Each crop is lined up and scaled, so a tiny baby and a grown-up can be compared by shape rather than size.
      </p>
      {note ? <p className="status">{note}</p> : null}
      <div className="feature-grid">
        {FEATURES.map((meta) => {
          const feature = found.get(meta.id);
          return (
            <article key={meta.id} className="feature-card" data-testid={`feature-${meta.id}`}>
              {feature ? (
                <CropImage blob={feature.cropBlob} alt={`${meta.label}: ${feature.friendly}`} />
              ) : (
                <div className="crop-fallback">
                  <span>{babyNeed(meta.needs)}</span>
                </div>
              )}
              <h2>{meta.label}</h2>
              <p>{feature ? feature.friendly : "Not enough photos"}</p>
              {feature ? <p className="detail">{feature.detail}</p> : null}
            </article>
          );
        })}
      </div>
      <div className="actions">
        <button className="btn secondary" type="button" onClick={onRetake} disabled={busy}>
          Retake photos
        </button>
        <button className="btn" type="button" onClick={onAddFamily}>
          Add family
        </button>
      </div>
      <p className="privacy">Photos stay on this phone. Nothing is uploaded.</p>
    </section>
  );
}
