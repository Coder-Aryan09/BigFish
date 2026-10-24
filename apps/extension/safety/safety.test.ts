// Safety unit tests (Node, no browser): PII detection, vault rehydration,
// action policy and URL policy.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { luhnValid, rehydrateArgs, sanitizeObservationForModel, verhoeffValid } from "./privacy.ts";
import { classifyAction } from "./action-policy.ts";
import { isForbiddenUrl } from "./url-policy.ts";

const ORIGIN = "https://mail.example.com";
const tokens = (text: string) => text.match(/\[[A-Z]+_[0-9A-F]{4}\]/g) ?? [];

describe("PII redaction", () => {
  test("emails, phones, PAN become tokens", () => {
    const out = sanitizeObservationForModel(
      "Mail priya@example.com, call +91 98765 43210 or (415) 555-0134, PAN ABCDE1234F",
      ORIGIN,
    );
    assert.doesNotMatch(out, /priya@example\.com|98765 43210|555-0134|ABCDE1234F/);
    assert.equal(tokens(out).length, 4);
    assert.match(out, /\[EMAIL_[0-9A-F]{4}\]/);
    assert.match(out, /\[PAN_[0-9A-F]{4}\]/);
  });

  test("the same value always gets the same token", () => {
    const a = sanitizeObservationForModel("x@y.io", ORIGIN);
    const b = sanitizeObservationForModel("again: x@y.io", ORIGIN);
    assert.equal(tokens(a)[0], tokens(b)[0]);
  });

  test("cards need a valid Luhn checksum", () => {
    assert.equal(luhnValid("4111 1111 1111 1111"), true);
    assert.equal(luhnValid("4111 1111 1111 1112"), false);
    assert.match(sanitizeObservationForModel("card 4111 1111 1111 1111", ORIGIN), /\[CARD_/);
    assert.doesNotMatch(sanitizeObservationForModel("order 4111 1111 1111 1112", ORIGIN), /\[CARD_/);
  });

  test("Aadhaar needs a valid Verhoeff checksum", () => {
    // 2345 6789 0124 has a valid Verhoeff check digit; changing the last digit breaks it.
    assert.equal(verhoeffValid("2345 6789 0124"), true);
    assert.equal(verhoeffValid("2345 6789 0123"), false);
    assert.match(sanitizeObservationForModel("Aadhaar 2345 6789 0124", ORIGIN), /\[AADHAAR_/);
    assert.doesNotMatch(sanitizeObservationForModel("ref 2345 6789 0123", ORIGIN), /\[AADHAAR_/);
  });

  test("ids inside URLs and long numbers are left alone", () => {
    const text = "https://www.google.com/?zx=1792860363093 order #8765432109876 →/c/6adce210-0a4c-83ee";
    assert.equal(sanitizeObservationForModel(text, ORIGIN), text);
  });
});

describe("rehydration", () => {
  test("a token goes back to the real value on its own origin", () => {
    const [token] = tokens(sanitizeObservationForModel("to: priya@example.com", ORIGIN));
    const { args, crossOrigins, rehydrated } = rehydrateArgs("browser_type", { ref: "1:2", text: `Hi ${token}` }, ORIGIN);
    assert.equal(args.text, "Hi priya@example.com");
    assert.deepEqual(crossOrigins, []);
    assert.equal(rehydrated, true);
  });

  test("using it on another origin is reported, so the action needs approval", () => {
    const [token] = tokens(sanitizeObservationForModel("secret@bank.example", "https://bank.example"));
    const { crossOrigins } = rehydrateArgs("browser_type", { text: token }, "https://other.example");
    assert.deepEqual(crossOrigins, ["https://bank.example"]);
    assert.equal(classifyAction("browser_type", {}, { crossOrigins }).needsApproval, true);
  });

  test("unknown tokens stay as they are", () => {
    const { args, rehydrated } = rehydrateArgs("browser_type", { text: "[EMAIL_FFFF]" }, ORIGIN);
    assert.equal(args.text, "[EMAIL_FFFF]");
    assert.equal(rehydrated, false);
  });
});

describe("action policy", () => {
  const needs = (tool: string, args: object, desc: object) => classifyAction(tool, args, desc).needsApproval;

  test("risky buttons need approval, normal ones do not", () => {
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Send" }), true);
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Delete account" }), true);
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Place order" }), true);
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Next" }), false);
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Sign in" }), false);
    assert.equal(needs("browser_click", { ref: "1:1" }, { label: "Sign up" }), false);
  });

  test("Enter or submit inherits the form's risk, search boxes are exempt", () => {
    assert.equal(needs("browser_press_key", { key: "Enter" }, { formSubmitLabel: "Send" }), true);
    assert.equal(needs("browser_press_key", { key: "Enter" }, { formSubmitLabel: "Send", isSearch: true }), false);
    assert.equal(needs("browser_type", { submit: true }, { formSubmitLabel: "Pay now" }), true);
    assert.equal(needs("browser_type", { submit: false }, { formSubmitLabel: "Pay now" }), false);
    assert.equal(needs("browser_fill_form", { submit_ref: "1:9" }, { formSubmitLabel: "Send" }), true);
  });
});

describe("URL policy", () => {
  test("browser internals and file URLs are blocked", () => {
    for (const url of ["chrome://settings", "file:///etc/passwd", "javascript:alert(1)", "https://chromewebstore.google.com/x"]) {
      assert.equal(isForbiddenUrl(url), true, url);
    }
    assert.equal(isForbiddenUrl("https://example.com"), false);
    assert.equal(isForbiddenUrl("http://127.0.0.1:8080/form.html"), false);
  });
});
