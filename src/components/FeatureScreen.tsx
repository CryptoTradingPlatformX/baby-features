import { FEATURES, type Person } from "../types";
import { babyNeed } from "../analysis/compare";
import { featuresById } from "../analysis/compare";
import { CropImage } from "./CropImage";

export function FeatureScreen({
  person,
  onBack,
  onRetake,
  onAddFamily,
}: {
  person: Person;
  onBack: () => void;
  onRetake: () => void;
  onAddFamily: () => void;
}) {
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
        <button className="btn secondary" type="button" onClick={onRetake}>
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
