/** Personal text links. iOS uses `&body=`; Android uses `?body=`. */

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return plus ? `+${digits}` : digits;
}

export function smsPlatform(userAgent: string): "ios" | "android" {
  return /iPhone|iPad|iPod/i.test(userAgent) ? "ios" : "android";
}

export function smsHref(phone: string | null | undefined, body: string, userAgent: string): string {
  const number = normalizePhone(phone);
  const encoded = encodeURIComponent(body);
  if (smsPlatform(userAgent) === "ios") {
    return number ? `sms:${number}&body=${encoded}` : `sms:&body=${encoded}`;
  }
  return number ? `sms:${number}?body=${encoded}` : `sms:?body=${encoded}`;
}

export function inviteMessage(input: { name: string; babyName?: string | null; link: string }): string {
  const who = input.name.trim() || "there";
  const baby = input.babyName?.trim() || "the baby";
  return `Hi ${who}! I'm building a little page to see which of ${baby}'s features came from whom. Could you add 3 quick photos of your face (front, left side, right side)? Takes 1 minute: ${input.link}`;
}

export function uploadTokenFromHash(hash: string): string | null {
  const match = /^#\/upload\/([^/?#]+)/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
