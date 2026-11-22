import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import InviteLanding from "../InviteLanding";

describe("standalone Charts invitation screen", () => {
  it("shows a branded landing with one primary sign-in action and no provider promises", () => {
    const html = renderToStaticMarkup(<InviteLanding phase="sign-in" />);
    expect(html).toContain("Join a shared songbook");
    expect(html).toContain("Continue to sign in");
    expect(html).not.toContain("create an account");
    expect(html).not.toContain("Google");
    expect(html).not.toContain("Properties");
    expect(html).not.toContain("My Songs");
  });

  it("gives a signed-in visitor a direct join action without reflecting the invite token", () => {
    const html = renderToStaticMarkup(<InviteLanding phase="join" />);
    expect(html).toContain(">Join songbook</button>");
    expect(html).not.toContain("Continue to sign in");
    expect(html).not.toContain("<input");
  });

  it("provides an accessible loading state, disabled busy controls and inline errors", () => {
    expect(renderToStaticMarkup(<InviteLanding phase="loading" />)).toContain('role="status"');
    const html = renderToStaticMarkup(<InviteLanding phase="join" busy error="Test error" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Test error");
    expect(html).toContain("disabled");
  });
});
