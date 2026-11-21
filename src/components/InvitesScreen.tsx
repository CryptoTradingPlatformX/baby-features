import { useEffect, useMemo, useState } from "react";
import type { Person } from "../types";
import { uid } from "../types";
import {
  createInviteApi,
  InviteApiError,
  inviteApiUrl,
  readOwnerKey,
  writeOwnerKey,
  type InviteApi,
  type OwnerInvite,
} from "../invites/api";
import { filledSlots, importPhotoUrls, inviteStatus, personForImport, suggestPerson, withImportedPhoto } from "../invites/importPlan";
import { loadInviteRecords, publicUploadLink, saveInviteRecords, type InviteRecord } from "../invites/records";
import { inviteMessage, smsHref } from "../invites/sms";
import { canvasToBlob, releaseCanvas } from "../vision/imageutil";

const ROLES = [
  "Mom",
  "Dad",
  "Grandma (Mom's side)",
  "Grandma (Dad's side)",
  "Grandpa (Mom's side)",
  "Grandpa (Dad's side)",
  "Sister",
  "Brother",
  "Aunt",
  "Uncle",
];

interface Draft {
  id: string;
  name: string;
  role: string;
  phone: string;
}

export function InvitesScreen({
  babyName,
  family,
  onBack,
  onSave,
  api,
}: {
  babyName?: string;
  family: Person[];
  onBack: () => void;
  onSave: (person: Person) => Promise<void>;
  api?: InviteApi;
}) {
  const base = inviteApiUrl();
  const client = useMemo(() => api ?? (base ? createInviteApi(base) : null), [api, base]);
  const [ownerName, setOwnerName] = useState(() => localStorage.getItem("baby-features-owner-name") || "");
  const [records, setRecords] = useState<InviteRecord[]>(() => loadInviteRecords());
  const [remote, setRemote] = useState<Record<string, OwnerInvite>>({});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [role, setRole] = useState(ROLES[0]);
  const [name, setName] = useState(ROLES[0]);
  const [phone, setPhone] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleKey, setStaleKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const canShare = typeof navigator.share === "function";

  useEffect(() => {
    saveInviteRecords(records);
  }, [records]);

  useEffect(() => {
    if (!client || !readOwnerKey()) return;
    void refresh(client, setRemote, noteFailure);
  }, [client]);

  function noteFailure(reason: unknown) {
    if (reason instanceof InviteApiError && reason.status === 401) {
      setStaleKey(true);
      setError("This phone's saved invite key isn't recognized. Start fresh to create new links. Older links stay on the server, but this phone can no longer check them.");
      return;
    }
    setStaleKey(false);
    setError(reason instanceof Error ? reason.message : "The invite service could not complete that.");
  }

  function startFresh() {
    writeOwnerKey(null);
    saveInviteRecords([]);
    setRecords([]);
    setRemote({});
    setStaleKey(false);
    setError(null);
    setNotice("Started fresh. The next links use a new key.");
  }

  function addDraft() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDrafts((current) => [...current, { id: uid(), name: trimmed, role, phone: phone.trim() }]);
    setPhone("");
  }

  async function createLinks() {
    if (!client || drafts.length === 0) return;
    setBusy("create");
    setError(null);
    try {
      const who = ownerName.trim() || "Me";
      localStorage.setItem("baby-features-owner-name", who);
      const created = await client.createInvites(
        {
          ownerName: who,
          babyName: babyName?.trim() || undefined,
          people: drafts.map((draft) => ({ name: draft.name, role: draft.role })),
        },
        readOwnerKey(),
      );
      writeOwnerKey(created.ownerKey);
      const added = created.invites.map((invite, index) => ({
        token: invite.token,
        name: invite.name || drafts[index]?.name || "Family",
        role: invite.role || drafts[index]?.role || "Family",
        phone: drafts[index]?.phone || undefined,
        link: invite.link || publicUploadLink(invite.token),
        expiresAt: invite.expiresAt,
      }));
      setRecords((current) => [...added, ...current]);
      setDrafts([]);
      setNotice("Invite links are ready. Text, share, or copy each one.");
      await refresh(client, setRemote, noteFailure);
    } catch (reason) {
      noteFailure(reason);
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setToast("Link copied");
    } catch {
      setToast("Could not copy. Select the link and copy it.");
    }
    window.setTimeout(() => setToast(null), 1800);
  }

  async function importInvite(record: InviteRecord) {
    if (!client) return;
    setBusy(record.token);
    setError(null);
    try {
      const key = readOwnerKey();
      if (!key) throw new Error("Create invite links on this phone before importing.");
      const freshList = await client.listOwnerInvites(key);
      const fresh = freshList.find((item) => item.token === record.token);
      const urls = importPhotoUrls(fresh ?? {});
      const angles = (Object.keys(urls) as (keyof typeof urls)[]).filter((angle) => urls[angle]);
      if (!angles.length) throw new Error("No photos are ready. Check for photos and import right away.");
      const choice = targets[record.token] || suggestPerson(family, record)?.id || "create";
      let person = personForImport(family, record, choice);
      const vision = await import("../vision/analyze");
      for (const angle of angles) {
        const url = urls[angle];
        if (!url) continue;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not download the ${angle} photo.`);
        const original = await response.blob();
        const analyzed = await vision.analyzePhotoBlob(original, angle);
        const blob = await canvasToBlob(analyzed.canvas, 0.9);
        person = withImportedPhoto(person, angle, {
          blob,
          width: analyzed.canvas.width,
          height: analyzed.canvas.height,
          analysis: analyzed.analysis,
        });
        releaseCanvas(analyzed.canvas);
        await onSave(person);
      }
      await client.deleteInvite(key, record.token);
      setRecords((current) => current.filter((item) => item.token !== record.token));
      setRemote((current) => {
        const next = { ...current };
        delete next[record.token];
        return next;
      });
      setNotice(`${record.name}'s photos are on this phone and were removed from the server.`);
    } catch (reason) {
      noteFailure(reason);
    } finally {
      setBusy(null);
    }
  }

  async function revoke(token: string) {
    if (!client) return;
    setBusy(token);
    setError(null);
    try {
      const key = readOwnerKey();
      if (key) await client.deleteInvite(key, token);
      setRecords((current) => current.filter((item) => item.token !== token));
    } catch (reason) {
      noteFailure(reason);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="screen" data-testid="invites">
      <header className="top">
        <button className="icon-btn" type="button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div>
          <p className="eyebrow">{babyName || "Family"}</p>
          <h1>Family invites</h1>
        </div>
      </header>
      <p className="lede">
        Each person gets their own link to add a front photo and both sides. Texts are sent by your phone, not by a server.
      </p>
      {error ? (
        <div className="issue error retry-banner">
          <p>{error}</p>
          {staleKey ? (
            <button className="btn secondary" type="button" data-testid="start-fresh" onClick={startFresh}>
              Start fresh
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="issue">{notice}</p> : null}

      <form
        className="card form"
        onSubmit={(event) => {
          event.preventDefault();
          addDraft();
        }}
      >
        <label>
          Your name
          <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Alex" />
        </label>
        <label>
          Their name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              if (ROLES.includes(name)) setName(event.target.value);
            }}
          >
            {ROLES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Phone, optional
          <input value={phone} inputMode="tel" placeholder="555 010 2030" onChange={(event) => setPhone(event.target.value)} />
        </label>
        <button className="btn secondary" type="submit">
          Add to list
        </button>
      </form>

      {drafts.length ? (
        <ul className="people">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <span>
                <strong>{draft.name}</strong>
                <small>
                  {draft.role}
                  {draft.phone ? ` · ${draft.phone}` : ""}
                </small>
              </span>
              <button className="text-btn" type="button" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button className="btn" type="button" data-testid="create-invites" disabled={!drafts.length || busy === "create"} onClick={() => void createLinks()}>
        {busy === "create" ? "Creating links…" : "Create invite links"}
      </button>

      <div className="actions">
        <button
          className="btn secondary"
          type="button"
          data-testid="refresh-invites"
          disabled={busy != null}
          onClick={() => client && void refresh(client, setRemote, noteFailure)}
        >
          Check for photos
        </button>
      </div>

      <ul className="invite-list">
        {records.map((record) => {
          const info = remote[record.token];
          const status = inviteStatus(info?.slots, info?.status);
          const ready = status !== "expired" && (filledSlots(info?.slots).length > 0 || Object.keys(importPhotoUrls(info ?? {})).length > 0);
          const message = inviteMessage({ name: record.name, babyName, link: record.link });
          const suggested = suggestPerson(family, record)?.id ?? "create";
          return (
            <li key={record.token} className="card form invite-card" data-testid={`invite-${record.token}`}>
              <div className="invite-head">
                <div>
                  <h2>{record.name}</h2>
                  <p className="note">{record.role}</p>
                </div>
                <span className={`badge status-${status}`}>{status}</span>
              </div>
              <div className="actions">
                <a className="btn" data-testid={`text-${record.token}`} href={smsHref(record.phone, message, navigator.userAgent)}>
                  Text invite
                </a>
                {canShare ? (
                  <button
                    className="btn secondary"
                    type="button"
                    data-testid={`share-${record.token}`}
                    onClick={() => void navigator.share({ title: "Baby Features", text: message, url: record.link })}
                  >
                    Share
                  </button>
                ) : null}
                <button className="btn secondary" type="button" data-testid={`copy-${record.token}`} onClick={() => void copyLink(record.link)}>
                  Copy link
                </button>
              </div>
              {ready ? (
                <label>
                  Save photos to
                  <select
                    value={targets[record.token] ?? suggested}
                    onChange={(event) => setTargets((current) => ({ ...current, [record.token]: event.target.value }))}
                  >
                    <option value="create">New person, {record.name}</option>
                    {family.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.relationship !== person.name ? ` (${person.relationship})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="note">Waiting for photos.</p>
              )}
              <div className="actions">
                <button className="btn" type="button" disabled={!ready || busy != null} onClick={() => void importInvite(record)}>
                  {busy === record.token ? "Importing…" : "Import"}
                </button>
                <button className="btn ghost" type="button" disabled={busy != null} onClick={() => void revoke(record.token)}>
                  Revoke
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {toast ? (
        <p className="toast" role="status" data-testid="copy-toast">
          {toast}
        </p>
      ) : null}
    </section>
  );
}

async function refresh(
  client: InviteApi,
  setRemote: (value: Record<string, OwnerInvite>) => void,
  onError: (reason: unknown) => void,
) {
  const key = readOwnerKey();
  if (!key) return;
  try {
    const list = await client.listOwnerInvites(key);
    const next: Record<string, OwnerInvite> = {};
    for (const invite of list) next[invite.token] = invite;
    setRemote(next);
  } catch (reason) {
    onError(reason);
  }
}
