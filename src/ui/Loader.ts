/**
 * Loading screen controller. The markup and styles live in index.html so the
 * overlay paints before the bundle is parsed; this class only moves the bar,
 * swaps the stage label, shows "Click to enter" and fades the overlay away.
 *
 * The enter click is the user gesture the rest of the page needs: pointer lock
 * and the AudioContext both require one, so main.ts forwards it to the canvas.
 */
export class Loader {
  private readonly root: HTMLElement | null;
  private readonly fill: HTMLElement | null;
  private readonly stage: HTMLElement | null;
  private readonly pct: HTMLElement | null;
  private lastPct = -1;
  private dismissed = false;

  constructor(root: HTMLElement | null = document.getElementById("loader")) {
    this.root = root;
    this.fill = root?.querySelector<HTMLElement>(".fill") ?? null;
    this.stage = root?.querySelector<HTMLElement>(".stage") ?? null;
    this.pct = root?.querySelector<HTMLElement>(".pct") ?? null;
  }

  /** Move the bar to `fraction` (0..1) and show `label` as the current stage. */
  set(fraction: number, label: string): void {
    if (!this.root || this.dismissed) return;
    const f = Math.min(1, Math.max(0, fraction));
    if (this.fill) this.fill.style.width = `${(f * 100).toFixed(2)}%`;
    const pct = Math.floor(f * 100);
    if (pct !== this.lastPct && this.pct) {
      this.lastPct = pct;
      this.pct.textContent = `${pct}%`;
    }
    if (this.stage && label && this.stage.textContent !== label) this.stage.textContent = label;
  }

  /** Bar to 100 %, swap in "Click to enter" and resolve on the click (or Enter / Space). */
  waitForEnter(): Promise<void> {
    if (!this.root || this.dismissed) return Promise.resolve();
    const root = this.root;
    this.set(1, "Ready");
    root.classList.add("enter");
    root.setAttribute("aria-live", "off");
    return new Promise((resolve) => {
      const done = () => {
        root.removeEventListener("click", done);
        window.removeEventListener("keydown", onKey);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Enter" || e.code === "Space") done();
      };
      root.addEventListener("click", done);
      window.addEventListener("keydown", onKey);
    });
  }

  /** Fade the overlay out and remove it. `instant` skips the fade (capture harness). */
  dismiss(instant = false): Promise<void> {
    if (!this.root || this.dismissed) return Promise.resolve();
    this.dismissed = true;
    const root = this.root;
    if (instant) {
      root.remove();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        root.remove();
        resolve();
      };
      root.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 1000); // in case transitions are disabled
      root.classList.add("out");
    });
  }

  /** Show a fatal boot error in place of the bar. */
  fail(message: string): void {
    if (!this.root) return;
    this.root.classList.remove("enter");
    const card = this.root.querySelector(".card");
    if (!card) return;
    const el = document.createElement("div");
    el.className = "error";
    el.textContent = message;
    card.appendChild(el);
    if (this.stage) this.stage.textContent = "Could not open";
  }
}
