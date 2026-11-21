const RECORD_KEY = "baby-features-invite-records";

export interface InviteRecord {
  token: string;
  name: string;
  role: string;
  phone?: string;
  link: string;
  expiresAt?: string;
}

export function loadInviteRecords(): InviteRecord[] {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InviteRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveInviteRecords(records: InviteRecord[]): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(records));
  } catch {
    /* private mode */
  }
}

export function publicUploadLink(token: string): string {
  return `https://cryptotradingplatformx.github.io/baby-features/#/upload/${encodeURIComponent(token)}`;
}
