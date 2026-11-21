import type { Angle } from "../types";
import type { InviteSlots, InviteStatus } from "./importPlan";

export const OWNER_KEY_STORAGE = "baby-features-owner-key";

export interface InvitePersonInput {
  name: string;
  role: string;
}

export interface CreatedInvite {
  token: string;
  name: string;
  role: string;
  link: string;
  expiresAt: string | number;
}

export interface CreateInvitesResponse {
  ownerKey: string;
  invites: CreatedInvite[];
}

export interface GuestInvite {
  name: string;
  role: string;
  ownerName: string;
  babyName?: string | null;
  status: InviteStatus | string;
  slots: InviteSlots;
  expiresAt?: string | null;
  /** Slots /complete threw away because they were over 15 MB or not an image. */
  rejected?: unknown;
}

export interface OwnerInvite {
  token: string;
  name: string;
  role: string;
  link?: string;
  status: InviteStatus | string;
  slots: InviteSlots;
  /** Presigned GET urls. They last about 15 minutes, so import must download immediately. */
  photos?: InviteSlots | null;
  createdAt?: string | number | null;
  expiresAt?: string | number | null;
}

export interface UploadTicket {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  maxBytes?: number;
  expiresIn?: number;
}

export class InviteApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "InviteApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function inviteApiUrl(value: string | null | undefined = import.meta.env.VITE_INVITE_API_URL): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.includes("REPLACE_ME")) return null;
  return trimmed.replace(/\/$/, "");
}

export function normalizeUploadTicket(raw: unknown): UploadTicket {
  const body = (raw ?? {}) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    maxBytes?: number;
    expiresIn?: number;
  };
  if (!body.url) throw new InviteApiError(0, "The upload link was missing a URL.");
  if (body.method && body.method.toUpperCase() !== "PUT") {
    throw new InviteApiError(0, "This upload link is not a direct photo upload.");
  }
  return {
    method: "PUT",
    url: body.url,
    headers: body.headers ?? {},
    maxBytes: body.maxBytes,
    expiresIn: body.expiresIn,
  };
}

/** PUT bytes with exactly the headers the server signed. Do not add or rewrite Content-Type. */
export function uploadRequest(ticket: UploadTicket, file: Blob): { url: string; method: "PUT"; headers: Record<string, string>; body: Blob } {
  if (ticket.maxBytes != null && file.size > ticket.maxBytes) {
    throw new InviteApiError(0, "That photo is too large. Try a smaller one.");
  }
  return { url: ticket.url, method: "PUT", headers: { ...ticket.headers }, body: file };
}

export interface InviteApi {
  createInvites(input: { ownerName: string; babyName?: string; people: InvitePersonInput[] }, ownerKey?: string | null): Promise<CreateInvitesResponse>;
  getInvite(token: string): Promise<GuestInvite>;
  requestUpload(token: string, slot: Angle, contentType: string): Promise<UploadTicket>;
  sendUpload(ticket: UploadTicket, file: Blob, onProgress?: (ratio: number) => void): Promise<void>;
  complete(token: string): Promise<GuestInvite>;
  listOwnerInvites(ownerKey: string): Promise<OwnerInvite[]>;
  deleteInvite(ownerKey: string, token: string): Promise<void>;
}

export function createInviteApi(baseUrl: string, fetchImpl: FetchLike = fetch): InviteApi {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}, ownerKey?: string | null): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (ownerKey) headers.set("x-owner-key", ownerKey);
    const response = await fetchImpl(`${root}${path}`, { ...init, headers });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let payload = {} as T & { message?: string };
    if (text) {
      try {
        payload = JSON.parse(text) as T & { message?: string };
      } catch {
        payload = { message: text } as T & { message?: string };
      }
    }
    if (!response.ok) {
      const detail = payload.message || (payload as { error?: string }).error;
      throw new InviteApiError(response.status, detail || (response.status === 404 ? "This invite link has expired." : "The invite service could not complete that."));
    }
    return payload;
  }

  return {
    createInvites(input, ownerKey) {
      return request<CreateInvitesResponse>("/invites", { method: "POST", body: JSON.stringify(input) }, ownerKey);
    },
    getInvite(token) {
      return request<GuestInvite>(`/invites/${encodeURIComponent(token)}`);
    },
    async requestUpload(token, slot, contentType) {
      const raw = await request<unknown>(`/invites/${encodeURIComponent(token)}/upload-url`, {
        method: "POST",
        body: JSON.stringify({ slot, contentType }),
      });
      return normalizeUploadTicket(raw);
    },
    sendUpload(ticket, file, onProgress) {
      return sendUpload(ticket, file, onProgress, fetchImpl);
    },
    complete(token) {
      return request<GuestInvite>(`/invites/${encodeURIComponent(token)}/complete`, { method: "POST", body: "{}" });
    },
    async listOwnerInvites(ownerKey) {
      const payload = await request<OwnerInvite[] | { invites?: OwnerInvite[] }>("/owner/invites", {}, ownerKey);
      if (Array.isArray(payload)) return payload;
      return payload.invites ?? [];
    },
    async deleteInvite(ownerKey, token) {
      const payload = await request<{ deleted?: boolean; token?: string }>(
        `/owner/invites/${encodeURIComponent(token)}`,
        { method: "DELETE" },
        ownerKey,
      );
      if (payload && payload.deleted === false) throw new InviteApiError(0, "The server did not delete that invite.");
    },
  };
}

export function sendUpload(
  ticket: UploadTicket,
  file: Blob,
  onProgress: ((ratio: number) => void) | undefined,
  fetchImpl: FetchLike,
): Promise<void> {
  const built = uploadRequest(ticket, file);
  if (onProgress && typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(built.method, built.url);
      for (const [key, value] of Object.entries(built.headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(1);
          resolve();
        } else {
          reject(new InviteApiError(xhr.status, "The photo did not upload. Try again."));
        }
      };
      xhr.onerror = () => reject(new InviteApiError(0, "The photo did not upload. Try again."));
      xhr.send(built.body);
    });
  }
  return fetchImpl(built.url, { method: built.method, headers: built.headers, body: built.body }).then((response) => {
    if (!response.ok) throw new InviteApiError(response.status, "The photo did not upload. Try again.");
    onProgress?.(1);
  });
}

export function readOwnerKey(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function writeOwnerKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(OWNER_KEY_STORAGE, key);
    else localStorage.removeItem(OWNER_KEY_STORAGE);
  } catch {
    /* private mode */
  }
}
