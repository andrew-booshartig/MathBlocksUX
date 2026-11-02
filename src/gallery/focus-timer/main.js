// A tile that times work, then a break, then work again. Its lengths are
// set in Extensions (this plugin's settings).
export function activate(matrixlab) {
  matrixlab.tiles.register({
    id: "focus-timer",
    title: "Focus timer",
    blurb: "Work and breaks, timed in turns",
    mount(el) {
      const minutes = (phase) => Math.max(1, Number(matrixlab.settings.get(phase)) || (phase === "focus" ? 25 : 5));
      let phase = "focus";
      let left = minutes(phase) * 60;
      let ticking = null;
      let rounds = 0;

      el.innerHTML = `
        <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:-apple-system,sans-serif;color:var(--t-text)">
          <div data-phase style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)"></div>
          <div data-time style="font-size:64px;font-weight:300;font-variant-numeric:tabular-nums"></div>
          <div style="display:flex;gap:8px">
            <button data-go></button>
            <button data-reset>Reset</button>
            <button data-skip>Skip</button>
          </div>
          <div data-rounds style="font-size:12px;color:var(--t-muted)"></div>
        </div>`;
      for (const b of el.querySelectorAll("button"))
        b.style.cssText = "padding:6px 14px;border-radius:8px;border:1px solid var(--t-line);background:transparent;color:var(--t-text);font:13px -apple-system,sans-serif;cursor:pointer";
      const $ = (name) => el.querySelector(`[data-${name}]`);

      const show = () => {
        const m = Math.floor(left / 60);
        const s = left % 60;
        $("time").textContent = `${m}:${String(s).padStart(2, "0")}`;
        $("phase").textContent = phase === "focus" ? "Work" : "Break";
        $("go").textContent = ticking ? "Pause" : left === minutes(phase) * 60 ? "Start" : "Go on";
        $("rounds").textContent = rounds ? `${rounds} round${rounds === 1 ? "" : "s"} done` : "";
      };
      const next = () => {
        if (phase === "focus") rounds += 1;
        phase = phase === "focus" ? "break" : "focus";
        left = minutes(phase) * 60;
        if (matrixlab.settings.get("tell")) matrixlab.notify(phase === "break" ? `Time for a ${minutes("break")}-minute break` : "Break's over — back to it");
      };
      const stop = () => {
        clearInterval(ticking);
        ticking = null;
      };
      $("go").onclick = () => {
        if (ticking) stop();
        else
          ticking = setInterval(() => {
            left -= 1;
            if (left <= 0) next();
            show();
          }, 1000);
        show();
      };
      $("reset").onclick = () => {
        stop();
        left = minutes(phase) * 60;
        show();
      };
      $("skip").onclick = () => {
        next();
        show();
      };
      // new lengths, from Extensions: taken up at once if it isn't running
      const off = matrixlab.settings.onChange(() => {
        if (!ticking) left = minutes(phase) * 60;
        show();
      });
      show();
      return () => {
        stop();
        off();
      };
    },
  });
}
