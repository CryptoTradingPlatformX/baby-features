import { useEffect, useMemo, useState } from "react";
import { assessRegion } from "../analysis/quality";
import type { Angle } from "../types";
import { GuideOverlay } from "./GuideOverlay";
import { createInviteApi, InviteApiError, inviteApiUrl, type GuestInvite, type InviteApi } from "../invites/api";
import { filledSlots, rejectionNotes, slotFilled } from "../invites/importPlan";
import { canvasToBlob, decodeImage, releaseCanvas } from "../vision/imageutil";

const SLOTS: { angle: Angle; title: string; hint: string }[] = [
  { angle: "front", title: "Front", hint: "Look straight at the camera, with both ears visible." },
  { angle: "left", title: "Left side", hint: "Turn so your left ear faces the camera." },
  { angle: "right", title: "Right side", hint: "Turn so your right ear faces the camera." },
];

export function GuestUpload({ token, api }: { token: string; api?: InviteApi }) {
  const base = inviteApiUrl();
  const client = useMemo(() => api ?? (base ? createInviteApi(base) : null), [api, base]);
  const [invite, setInvite] = useState<GuestInvite | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Angle | null>(null);
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState<Partial<Record<Angle, string[]>>>({});
  const [slotError, setSlotError] = useState<Partial<Record<Angle, string>>>({});

  useEffect(() => {
    let cancel = false;
    if (!client) {
      setLoadError("This upload page is not available right now.");
      return;
    }
    void client
      .getInvite(token)
      .then((next) => {
        if (!cancel) setInvite(next);
      })
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof InviteApiError && error.status === 404) setMissing(true);
        else setLoadError(error instanceof Error ? error.message : "Could not open this invite.");
      });
    return () => {
      cancel = true;
    };
  }, [token, client]);

  async function onFile(angle: Angle, file: File | undefined) {
    if (!file || !client || !invite) return;
    setSlotError((current) => ({ ...current, [angle]: undefined }));
    setBusy(angle);
    setProgress(0.05);
    try {
      const prepared = await downscale(file);
      setNotes((current) => ({ ...current, [angle]: prepared.notes }));
      setProgress(0.15);
      const ticket = await client.requestUpload(token, angle, prepared.blob.type || "image/jpeg");
      await client.sendUpload(ticket, prepared.blob, (ratio) => setProgress(0.15 + ratio * 0.75));
      const updated = await client.complete(token);
      const rejected = rejectionNotes(updated.rejected);
      const rejectedHere = rejected.filter((item) => item.slot === angle || item.slot == null);
      if (rejectedHere.length) {
        setSlotError((current) => ({ ...current, [angle]: rejectedHere.map((item) => item.message).join(" ") }));
      }
      setInvite((current) => {
        const slots = { ...(current?.slots ?? {}), ...(updated.slots ?? {}) };
        if (!rejected.some((item) => item.slot === angle)) slots[angle] = slots[angle] ?? true;
        return {
          ...(current ?? updated),
          ...updated,
          name: updated.name || current?.name || "",
          role: updated.role || current?.role || "",
          ownerName: updated.ownerName || current?.ownerName || "",
          babyName: updated.babyName ?? current?.babyName,
          slots,
        };
      });
      setProgress(1);
    } catch (error) {
      setSlotError((current) => ({
        ...current,
        [angle]: error instanceof Error ? error.message : "That photo did not upload. Try again.",
      }));
    } finally {
      setBusy(null);
    }
  }

  if (!client || loadError) {
    return (
      <section className="screen" data-testid="guest-invalid">
        <p className="eyebrow">Photo invite</p>
        <h1>This page is not available</h1>
        <p className="lede">{loadError ?? "Photo invites are turned off."}</p>
      </section>
    );
  }
  if (missing) {
    return (
      <section className="screen" data-testid="guest-invalid">
        <p className="eyebrow">Photo invite</p>
        <h1>This link has expired</h1>
        <p className="lede">Ask for a new invite. Old links stop working, and photos are removed from the server within 30 days.</p>
      </section>
    );
  }
  if (!invite) {
    return (
      <section className="screen">
        <p className="lede">Opening your invite…</p>
      </section>
    );
  }

  const done = filledSlots(invite.slots).length === 3;
  if (done && !editing) {
    return (
      <section className="screen" data-testid="guest-done">
        <p className="eyebrow">{invite.ownerName}</p>
        <h1>You're all set, {invite.name}</h1>
        <p className="lede">
          {invite.ownerName} can add your three photos to the comparison{invite.babyName ? ` for ${invite.babyName}` : ""}.
        </p>
        <button className="btn secondary" type="button" onClick={() => setEditing(true)}>
          Replace a photo
        </button>
        <p className="privacy">Photos are only used for this family comparison and are auto-deleted from the server within 30 days.</p>
      </section>
    );
  }

  return (
    <section className="screen" data-testid="guest-upload">
      <p className="eyebrow">From {invite.ownerName}</p>
      <h1>{invite.name}, three quick photos</h1>
      <p className="lede">
        {invite.babyName ? `${invite.babyName}'s` : "The"} comparison needs a front view and both sides. Soft light, hair away from the ear, and
        the whole face in frame.
      </p>
      {SLOTS.map((slot) => {
        const uploaded = slotFilled(invite.slots?.[slot.angle]);
        return (
          <article key={slot.angle} className="card slot-card" data-testid={`guest-slot-${slot.angle}`}>
            <h2>{slot.title}</h2>
            <p className="note">{slot.hint}</p>
            <div className="stage slot-guide" aria-hidden="true">
              <GuideOverlay angle={slot.angle} />
            </div>
            {uploaded ? <p className="status">Photo received. You can replace it.</p> : null}
            {notes[slot.angle]?.map((note) => (
              <p key={note} className="issue">
                {note}
              </p>
            ))}
            {slotError[slot.angle] ? <p className="issue error">{slotError[slot.angle]}</p> : null}
            {busy === slot.angle ? (
              <div className="progress" role="status">
                <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
                <span>Uploading {Math.round(progress * 100)}%</span>
              </div>
            ) : (
              <div className="actions">
                <label className="btn file-btn">
                  {uploaded ? "Retake" : "Take photo"}
                  <input
                    className="hidden-input"
                    data-testid={`capture-${slot.angle}`}
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void onFile(slot.angle, file);
                    }}
                  />
                </label>
                <label className="btn secondary file-btn">
                  Library
                  <input
                    className="hidden-input"
                    data-testid={`library-${slot.angle}`}
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void onFile(slot.angle, file);
                    }}
                  />
                </label>
              </div>
            )}
          </article>
        );
      })}
      <p className="privacy">Photos are only used for this family comparison and are auto-deleted from the server within 30 days.</p>
    </section>
  );
}

async function downscale(file: Blob): Promise<{ blob: Blob; notes: string[] }> {
  const canvas = await decodeImage(file, 1600);
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const sample = ctx?.getImageData(0, 0, Math.min(canvas.width, 180), Math.min(canvas.height, 180));
    const notes = sample
      ? assessRegion(sample.data, sample.width, sample.height, 0.5, false)
          .issues.filter((issue) => issue.code === "blur" || issue.code === "dark" || issue.code === "bright")
          .map((issue) => issue.message.replace("retake", "try another").replace("Retake", "Try another"))
      : [];
    const blob = await canvasToBlob(canvas, 0.86);
    return { blob, notes };
  } finally {
    releaseCanvas(canvas);
  }
}
