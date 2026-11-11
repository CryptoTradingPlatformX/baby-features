import { useMemo, useState } from "react";
import { compareFamily } from "../analysis/compare";
import { downloadBlob, renderSummary, resultsJson } from "../exportSummary";
import type { Person } from "../types";
import { FEATURES } from "../types";
import { featuresById } from "../analysis/compare";
import { CropImage } from "./CropImage";

function fmt(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(3);
}

export function ResultsScreen({
  baby,
  family,
  onBack,
  onAddFamily,
  onRerun,
  busy,
}: {
  baby: Person;
  family: Person[];
  onBack: () => void;
  onAddFamily: () => void;
  onRerun: () => void;
  busy: boolean;
}) {
  const comparison = useMemo(() => compareFamily(baby, family), [baby, family]);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [showMath, setShowMath] = useState(false);
  const crops = useMemo(() => {
    const map = new Map<string, ReturnType<typeof featuresById>>();
    map.set(baby.id, featuresById(baby));
    for (const person of family) map.set(person.id, featuresById(person));
    return map;
  }, [baby, family]);

  async function saveImage() {
    setExportNote(null);
    try {
      const blob = await renderSummary(baby.name, comparison);
      downloadBlob(blob, "baby-features.png");
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : "Could not make the summary image.");
    }
  }

  function saveJson() {
    const blob = new Blob([resultsJson(baby, family, comparison)], { type: "application/json" });
    downloadBlob(blob, "baby-features.json");
  }

  return (
    <section className="screen" data-testid="results">
      <header className="top">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <p className="eyebrow">Comparison</p>
          <h1>Who {baby.name} resembles</h1>
        </div>
      </header>

      <label className="math-toggle">
        <input
          type="checkbox"
          data-testid="show-math"
          checked={showMath}
          onChange={(event) => setShowMath(event.target.checked)}
        />
        Show the math
      </label>

      <article className="summary-card">
        <h2>{comparison.headline}</h2>
        <p>{comparison.tally}</p>
        {comparison.overall.length ? (
          <ul className="overall-list">
            {comparison.overall.map((row) => (
              <li key={row.personId}>
                <div>
                  <strong>{row.name}</strong>
                  {row.relationship !== row.name ? <span>{row.relationship}</span> : null}
                </div>
                <em>{Math.round(row.score * 100)}%</em>
                <div className="bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(row.score * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>Add a family member with at least one clear photo to start the comparison.</p>
        )}
      </article>

      {comparison.features.map((feature) => {
        const babyCrop = crops.get(baby.id)?.get(feature.id);
        const leader = feature.ranked[0];
        const leaderCrop = leader ? crops.get(leader.personId)?.get(feature.id) : undefined;
        const meta = FEATURES.find((item) => item.id === feature.id);
        return (
          <article key={feature.id} className="result-block" data-testid={`result-${feature.id}`}>
            <h2>{feature.sentence}</h2>
            {feature.babyMissing ? (
              <p className="issue">Not enough photos of {baby.name} for the {meta?.label.toLowerCase()}.</p>
            ) : leader && babyCrop && leaderCrop ? (
              <div className="pair">
                <figure>
                  <CropImage blob={babyCrop.cropBlob} alt={`${baby.name} ${feature.label}`} />
                  <figcaption>{baby.name}</figcaption>
                </figure>
                <figure>
                  <CropImage blob={leaderCrop.cropBlob} alt={`${leader.name} ${feature.label}`} />
                  <figcaption>
                    {leader.share == null ? leader.name : `${leader.name} · ${Math.round(leader.share * 100)}%`}
                  </figcaption>
                </figure>
              </div>
            ) : null}
            {feature.ranked.length > 1 && feature.ranked.some((row) => row.share != null) ? (
              <ol className="rank-list">
                {feature.ranked.map((row) => (
                  <li key={row.personId}>
                    <span>{row.name}</span>
                    <div className="bar" aria-hidden="true">
                      <span style={{ width: `${Math.round((row.share ?? 0) * 100)}%` }} />
                    </div>
                    <em>{Math.round((row.share ?? 0) * 100)}%</em>
                  </li>
                ))}
              </ol>
            ) : null}
            {showMath && feature.ranked.length ? (
              <div className="math" data-testid={`math-${feature.id}`}>
                <p>
                  Decided by <strong>{feature.driverText}</strong>
                  {feature.yardstick != null ? `. Distance between these adults: ${feature.yardstick.toFixed(2)}` : ""}
                </p>
                {feature.ranked.map((row) => (
                  <div key={row.personId} className="math-person">
                    <strong>
                      {row.name}
                      {row.share == null ? "" : ` · ${Math.round(row.share * 100)}%`}
                    </strong>
                    <ul>
                      <li>Shape distance {fmt(row.shapeDistance)}</li>
                      <li>Appearance distance {fmt(row.appearanceDistance)}</li>
                      <li>Outline distance {fmt(row.contourDistance)}</li>
                      <li>Proportion distance {fmt(row.ratioDistance)}</li>
                      <li>Combined distance {fmt(row.combinedDistance)}</li>
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
            {feature.unavailable.length ? (
              <ul className="missing">
                {feature.unavailable.map((row) => (
                  <li key={row.name}>
                    {row.name}: {row.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}

      <div className="actions">
        <button className="btn secondary wide" type="button" data-testid="rerun" onClick={onRerun} disabled={busy}>
          Re-run comparison
        </button>
      </div>
      <div className="actions">
        <button className="btn" type="button" onClick={() => void saveImage()}>
          Save summary image
        </button>
        <button className="btn secondary" type="button" onClick={saveJson}>
          Download JSON
        </button>
      </div>
      {family.length === 0 ? (
        <button className="btn wide" type="button" onClick={onAddFamily}>
          Add family
        </button>
      ) : null}
      {exportNote ? <p className="issue error">{exportNote}</p> : null}
      <p className="disclaimer">
        This compares how photos look. It is not a genetic test. Baby faces change quickly, so retaking pictures every few
        months is part of the fun.
      </p>
      <p className="privacy">Photos stay on this phone. The JSON file has scores only, not the pictures.</p>
    </section>
  );
}
