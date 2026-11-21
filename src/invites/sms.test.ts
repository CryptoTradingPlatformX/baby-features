import { describe, expect, it } from "vitest";
import { inviteMessage, smsHref, uploadTokenFromHash } from "./sms";

const BODY = "Hi Grandma! add photos https://example.test/x";
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8)";

describe("sms invite links", () => {
  it("uses an ampersand before the body on iOS", () => {
    const href = smsHref("+1 (555) 010-2030", BODY, IOS);
    expect(href.startsWith("sms:+15550102030&body=")).toBe(true);
    expect(decodeURIComponent(href.split("&body=")[1])).toBe(BODY);
  });

  it("uses a question mark before the body on Android", () => {
    const href = smsHref("5550102030", BODY, ANDROID);
    expect(href.startsWith("sms:5550102030?body=")).toBe(true);
    expect(decodeURIComponent(href.split("?body=")[1])).toBe(BODY);
  });

  it("omits the number when none was saved", () => {
    expect(smsHref("", BODY, IOS)).toBe(`sms:&body=${encodeURIComponent(BODY)}`);
    expect(smsHref("  ", BODY, ANDROID)).toBe(`sms:?body=${encodeURIComponent(BODY)}`);
    expect(smsHref(undefined, "a&b", ANDROID)).toBe("sms:?body=a%26b");
  });

  it("fills the baby name into the text", () => {
    const text = inviteMessage({ name: "Grandma", babyName: "Ada", link: "https://example.test/a" });
    expect(text).toContain("Hi Grandma!");
    expect(text).toContain("which of Ada's features");
    expect(text).toContain("https://example.test/a");
  });

  it("reads the guest token from the hash", () => {
    expect(uploadTokenFromHash("#/upload/abc")).toBe("abc");
    expect(uploadTokenFromHash("#/upload/a%2Fb")).toBe("a/b");
    expect(uploadTokenFromHash("#/features")).toBeNull();
  });
});
