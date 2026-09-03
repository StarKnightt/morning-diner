/**
 * The interaction hint: a small centre-bottom line, "E — Sit", that fades in
 * when a target is in reach and fades out otherwise. System font, no icons.
 * One DOM node, styles injected once; text only touches the DOM on change.
 */
const STYLE = `
.mdn-prompt{position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);
  font:500 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;
  color:rgba(255,255,255,.88);background:rgba(10,10,12,.34);padding:8px 13px 8px 10px;border-radius:5px;
  pointer-events:none;user-select:none;opacity:0;transition:opacity .18s ease;white-space:nowrap;
  text-shadow:0 1px 2px rgba(0,0,0,.5);backdrop-filter:blur(2px);z-index:20}
.mdn-prompt.on{opacity:1}
.mdn-prompt .k{display:inline-block;min-width:16px;text-align:center;padding:2px 5px;margin-right:8px;
  border:1px solid rgba(255,255,255,.55);border-radius:3px;font-size:12px;line-height:1;
  color:rgba(255,255,255,.95);background:rgba(255,255,255,.08)}
`;

export class Prompt {
  private readonly el: HTMLDivElement;
  private readonly text: Text;
  private readonly keyEl: HTMLSpanElement;
  private shown = false;
  private current = "";
  private currentKey: string;

  /** `instant` drops the fade (the capture harness wants deterministic frames). */
  constructor(key = "E", instant = false) {
    if (!document.getElementById("mdn-prompt-style")) {
      const style = document.createElement("style");
      style.id = "mdn-prompt-style";
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    this.el = document.createElement("div");
    this.el.className = "mdn-prompt";
    if (instant) this.el.style.transition = "none";
    this.el.setAttribute("aria-live", "polite");
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = key;
    this.keyEl = k;
    this.currentKey = key;
    this.text = document.createTextNode("");
    this.el.append(k, this.text);
    document.body.appendChild(this.el);
  }

  /** Show `label` (e.g. "Sit") under key glyph `key` (default "E"; "F" for the blinds), or hide when null. Cheap to call every frame. */
  set(label: string | null, key = "E"): void {
    if (label === null) {
      if (this.shown) {
        this.shown = false;
        this.el.classList.remove("on");
      }
      return;
    }
    if (key !== this.currentKey) {
      this.currentKey = key;
      this.keyEl.textContent = key;
    }
    if (label !== this.current) {
      this.current = label;
      this.text.data = `— ${label}`;
    }
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add("on");
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
