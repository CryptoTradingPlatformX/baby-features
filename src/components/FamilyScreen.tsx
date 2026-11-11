import { useState } from "react";
import type { Person } from "../types";
import { uid } from "../types";
import { CropImage } from "./CropImage";
import { featuresById } from "../analysis/compare";

const PRESETS = ["Mom", "Dad", "Grandma", "Grandpa", "Sister", "Brother", "Aunt", "Uncle"];

export function FamilyScreen({
  baby,
  family,
  onBack,
  onAdd,
  onOpen,
  onDelete,
  onCompare,
}: {
  baby: Person;
  family: Person[];
  onBack: () => void;
  onAdd: (person: Person) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCompare: () => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="screen">
      <header className="top">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <p className="eyebrow">{baby.name}</p>
          <h1>Family</h1>
        </div>
      </header>
      <p className="lede">
        Add anyone you have photos of. An old front photo still counts — we only score the features that photo can show, and
        mark the rest as not enough photos.
      </p>
      <ul className="people">
        {family.map((person) => {
          const front = featuresById(person).get("faceShape") ?? featuresById(person).get("eyes");
          return (
            <li key={person.id}>
              <button className="person" type="button" onClick={() => onOpen(person.id)}>
                <span className="avatar">
                  {front ? <CropImage blob={front.cropBlob} alt="" /> : <span>{person.name.slice(0, 1)}</span>}
                </span>
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    {person.relationship !== person.name ? `${person.relationship} · ` : ""}
                    {countPhotos(person)} of 3 photos
                  </small>
                </span>
              </button>
              <button className="text-btn danger" type="button" onClick={() => onDelete(person.id)}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {family.length === 0 ? <p className="note">No one added yet.</p> : null}
      {adding ? (
        <PersonForm
          onCancel={() => setAdding(false)}
          onCreate={(person) => {
            setAdding(false);
            onAdd(person);
          }}
        />
      ) : (
        <div className="actions">
          <button className="btn" type="button" data-testid="add-family" onClick={() => setAdding(true)}>
            Add someone
          </button>
          <button className="btn secondary" type="button" data-testid="compare" onClick={onCompare} disabled={family.length === 0}>
            Compare
          </button>
        </div>
      )}
    </section>
  );
}

function PersonForm({ onCreate, onCancel }: { onCreate: (person: Person) => void; onCancel: () => void }) {
  const [relationship, setRelationship] = useState("Mom");
  const [name, setName] = useState("Mom");
  const [custom, setCustom] = useState(false);
  const [touched, setTouched] = useState(false);

  return (
    <form
      className="card form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        const rel = (custom ? relationship : relationship).trim();
        if (!trimmed) return;
        onCreate({
          id: uid(),
          kind: "family",
          name: trimmed,
          relationship: rel || trimmed,
          createdAt: Date.now(),
          photos: {},
        });
      }}
    >
      <fieldset>
        <legend>Relationship</legend>
        <div className="chips">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={!custom && relationship === preset ? "chip active" : "chip"}
              onClick={() => {
                setCustom(false);
                setRelationship(preset);
                if (!touched) setName(preset);
              }}
            >
              {preset}
            </button>
          ))}
          <button type="button" className={custom ? "chip active" : "chip"} onClick={() => setCustom(true)}>
            Other
          </button>
        </div>
      </fieldset>
      {custom ? (
        <label>
          Relationship
          <input value={relationship} maxLength={40} onChange={(event) => setRelationship(event.target.value)} />
        </label>
      ) : null}
      <label>
        Name
        <input
          value={name}
          maxLength={40}
          required
          onChange={(event) => {
            setTouched(true);
            setName(event.target.value);
          }}
        />
      </label>
      <div className="actions">
        <button className="btn secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn" type="submit">
          Add photos
        </button>
      </div>
    </form>
  );
}

function countPhotos(person: Person): number {
  return ["front", "left", "right"].filter((angle) => person.photos[angle as "front" | "left" | "right"]).length;
}
