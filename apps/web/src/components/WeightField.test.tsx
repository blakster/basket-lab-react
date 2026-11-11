import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeightField } from "./WeightField";

function getWeight() {
  return screen.getByRole("textbox", { name: "Weight" }) as HTMLInputElement;
}

describe("WeightField", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the field empty after backspace instead of snapping to 0", () => {
    const onCommit = vi.fn();
    render(<WeightField value={100} onCommit={onCommit} />);
    const input = getWeight();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "4" } });
    expect(input.value).toBe("4");

    fireEvent.change(input, { target: { value: "40" } });
    expect(input.value).toBe("40");

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(40);
  });

  it("does not turn leftover zeros from 100 into a live 0", () => {
    const onCommit = vi.fn();
    render(<WeightField value={100} onCommit={onCommit} />);
    const input = getWeight();

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "00" } });

    expect(input.value).toBe("00");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
