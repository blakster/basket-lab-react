import { afterEach, describe, expect, it } from "vitest";
import { prefersReducedMotion, scriptScrollBehavior } from "./motion";

const defaultMatchMedia = window.matchMedia;

function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: defaultMatchMedia,
  });
});

describe("prefersReducedMotion", () => {
  it("reads the reduce media query", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("treats a missing matchMedia as no preference", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("scriptScrollBehavior", () => {
  it("scrolls smoothly by default", () => {
    mockMatchMedia(false);
    expect(scriptScrollBehavior()).toBe("smooth");
  });

  it("jumps instantly when reduced motion is requested", () => {
    mockMatchMedia(true);
    expect(scriptScrollBehavior()).toBe("auto");
  });
});
