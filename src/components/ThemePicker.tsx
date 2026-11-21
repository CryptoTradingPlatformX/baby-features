import { useEffect, useId, useRef, useState } from "react";
import {
  applyAppearance,
  readAppearance,
  systemPrefersDark,
  type Appearance,
} from "../theme";

const OPTIONS: { id: Appearance; label: string; swatch: string }[] = [
  { id: "clarity", label: "Clarity", swatch: "clarity" },
  { id: "neon", label: "Neon Studio", swatch: "neon" },
  { id: "cozy", label: "Cozy", swatch: "cozy" },
  { id: "command", label: "Command Center", swatch: "command" },
  { id: "headline", label: "Headline", swatch: "headline" },
  { id: "lavender", label: "Lavender Glass", swatch: "lavender" },
  { id: "system", label: "Match system", swatch: "system" },
];

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Appearance>(() => readAppearance());
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<Appearance>).detail;
      if (detail) setChoice(detail);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (readAppearance() === "system") applyAppearance("system", media.matches);
    };
    window.addEventListener("baby-features-appearance", onChange);
    media.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener("baby-features-appearance", onChange);
      media.removeEventListener("change", onSystem);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Appearance) {
    setChoice(next);
    applyAppearance(next, systemPrefersDark());
    setOpen(false);
  }

  return (
    <div className="theme-dock" ref={rootRef}>
      <button
        className="theme-button"
        type="button"
        data-testid="theme-button"
        aria-label="Appearance"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-dots" aria-hidden="true" />
        <span className="theme-button-label">Appearance</span>
      </button>
      {open ? (
        <div className="theme-menu" id={menuId} role="listbox" aria-label="Appearance">
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              className="theme-option"
              type="button"
              role="option"
              data-testid={`theme-${option.id}`}
              aria-selected={choice === option.id}
              onClick={() => choose(option.id)}
            >
              <span className="swatch" data-swatch={option.swatch} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
