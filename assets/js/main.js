/* ============================================================================
   SWISS ARMY CAMERA — interactions & data-driven rendering
   Vanilla JS, no dependencies. Everything reads from window.SAC (data.js).
   ========================================================================== */
(function () {
  "use strict";
  const D = window.SAC;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const fmt = (n) => n.toLocaleString("en-US");
  const usd = (n) =>
    "$" + Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

  /* ------------------------------------------------------ §03 What it is -- */
  const WHATIS = [
    ["Pro camera app", "Full manual command of the sensor."],
    ["Recording studio", "A mobile OBS-style capture suite."],
    ["Green-screen compositor", "Chroma key, segmentation, real layers."],
    ["AI visual assistant", "The camera that reads and measures."],
    ["Timelapse studio", "Intervals from seconds to seasons."],
    ["Manual-control camera", "ISO, shutter, WB, focus, RAW."],
    ["Screen + facecam recorder", "Tutorials, gameplay, walkthroughs."],
    ["Experimental camera lab", "Computational imaging you can run today."],
    ["Attachment platform", "An open ecosystem for optics & modules."],
  ];
  (function whatis() {
    const g = $("#whatisGrid");
    WHATIS.forEach(([t, d], i) => {
      const tile = el("article", "tile");
      tile.append(
        el("span", "tile__n", String(i + 1).padStart(2, "0")),
        el("h3", "tile__t", t),
        el("p", "tile__d", d)
      );
      g.appendChild(tile);
    });
  })();

  /* -------------------------------------------------- §04 Feature matrix -- */
  (function matrix() {
    const list = $("#matrixList");
    D.FEATURE_MATRIX.forEach((group) => {
      const card = el("article", "mcard");
      card.dataset.group = group.id;

      const head = el("button", "mcard__head");
      head.type = "button";
      head.setAttribute("aria-expanded", "false");

      const titles = el("div", "mcard__titles");
      titles.append(
        el("h3", "mcard__name", group.name),
        el("p", "mcard__lede", group.lede)
      );

      const meta = el("div", "mcard__meta");
      const tags = el("div", "mcard__tags");
      group.tags.forEach((t) => tags.appendChild(el("span", "mtag", t)));
      meta.append(
        tags,
        el("span", "mcard__count", group.features.length + " tools"),
        el("span", "mcard__chev", "+")
      );

      head.append(el("span", "mcard__id", group.id), titles, meta);

      const body = el("div", "mcard__body");
      const inner = el("div", "mcard__inner");
      const feats = el("div", "mcard__features");
      group.features.forEach((f) =>
        feats.appendChild(el("div", "mfeat", "<i>▸</i><span>" + f + "</span>"))
      );
      inner.appendChild(feats);
      body.appendChild(inner);

      head.addEventListener("click", () => {
        const open = card.classList.toggle("is-open");
        head.setAttribute("aria-expanded", String(open));
        head.querySelector(".mcard__chev").textContent = open ? "+" : "+";
      });

      card.append(head, body);
      list.appendChild(card);
    });

    // Expand / collapse all
    const toggleBtn = $('[data-matrix-toggle="expand"]');
    toggleBtn.addEventListener("click", () => {
      const cards = $$(".mcard", list);
      const anyClosed = cards.some((c) => !c.classList.contains("is-open"));
      cards.forEach((c) => {
        c.classList.toggle("is-open", anyClosed);
        c.querySelector(".mcard__head").setAttribute("aria-expanded", String(anyClosed));
      });
      toggleBtn.textContent = anyClosed ? "Collapse all" : "Expand all";
    });
  })();

  /* --------------------------------------------------- §05 Hard truths --- */
  (function truths() {
    const toneVar = {
      go: "--go",
      device: "--device",
      native: "--native",
      attach: "--attach",
      stop: "--stop",
    };
    // Legend
    const legend = $("#truthLegend");
    Object.values(D.CAPABILITY_LEVELS).forEach((lv) => {
      const item = el("span", "legend__item");
      const sw = el("span", "legend__swatch");
      sw.style.background = "var(" + toneVar[lv.tone] + ")";
      item.append(sw, document.createTextNode(lv.label));
      legend.appendChild(item);
    });
    // Cards
    const grid = $("#truthsGrid");
    D.LIMITATIONS.forEach((lim) => {
      const lv = D.CAPABILITY_LEVELS[lim.level];
      const color = "var(" + toneVar[lv.tone] + ")";
      const card = el("article", "tcard");
      card.style.borderLeftColor = color;

      const tag = el("span", "tcard__tag");
      const dot = el("span", "dot");
      dot.style.background = color;
      tag.append(dot, document.createTextNode(lv.label));

      card.append(
        tag,
        el("h3", "tcard__title", lim.title),
        el("p", "tcard__body", lim.body)
      );
      grid.appendChild(card);
    });
  })();

  /* ------------------------------------------------------- §06 Stack ----- */
  (function stack() {
    const build = (dl, rows) =>
      rows.forEach(([k, v]) => {
        const d = el("div");
        d.append(el("dt", null, k), el("dd", null, v));
        dl.appendChild(d);
      });
    build($("#stackWeb"), D.STACK.website);
    build($("#stackApp"), D.STACK.app);
  })();

  /* ------------------------------------------------------ §07 App UX ----- */
  (function ux() {
    const tabsWrap = $("#uxTabs");
    const panel = $("#uxPanel");
    const render = (i) => {
      const t = D.APP_TABS[i];
      panel.innerHTML = "";
      panel.append(
        el("span", "uxpanel__num", "TAB " + String(i + 1).padStart(2, "0") + " / " + D.APP_TABS.length),
        el("div", "uxpanel__glyph", t.glyph),
        el("h3", "uxpanel__name", t.name),
        el("p", "uxpanel__detail", t.detail)
      );
    };
    D.APP_TABS.forEach((t, i) => {
      const b = el("button", "uxtab" + (i === 0 ? " is-active" : ""));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.append(
        el("span", "uxtab__glyph", t.glyph),
        el("span", "uxtab__name", t.name),
        el("span", "uxtab__i", String(i + 1).padStart(2, "0"))
      );
      b.addEventListener("click", () => {
        $$(".uxtab", tabsWrap).forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        render(i);
      });
      tabsWrap.appendChild(b);
    });
    render(0);
  })();

  /* ----------------------------------------------------- §08 Pricing ----- */
  (function pricing() {
    const grid = $("#pricingGrid");
    D.PLANS.forEach((p) => {
      const card = el("article", "plan" + (p.accent ? " plan--accent" : ""));
      if (p.accent) card.appendChild(el("span", "plan__flag", "Most popular"));
      card.append(
        el("span", "plan__name", p.name),
        el("div", "plan__price", p.price),
        el("span", "plan__cadence", p.cadence)
      );
      const ul = el("ul", "plan__features");
      p.features.forEach((f) =>
        ul.appendChild(el("li", null, "<i>✚</i><span>" + f + "</span>"))
      );
      card.appendChild(ul);
      grid.appendChild(card);
    });
  })();

  /* ------------------------------------------- §09 Market / calculator --- */
  (function market() {
    // Static tier table
    const tbody = $("#revTable tbody");
    D.REVENUE_TIERS.forEach((n) => {
      const m = n * D.PRICE;
      const tr = el("tr");
      tr.append(
        el("td", null, fmt(n)),
        el("td", null, usd(m)),
        el("td", null, usd(m * 12))
      );
      tbody.appendChild(tr);
    });

    // Interactive slider
    const slider = $("#subSlider");
    const subsOut = $("#calcSubs");
    const monOut = $("#calcMonthly");
    const annOut = $("#calcAnnual");
    const update = () => {
      const n = +slider.value;
      const m = n * D.PRICE;
      subsOut.textContent = fmt(n);
      monOut.textContent = usd(m);
      annOut.textContent = usd(m * 12);
      const pct = (n / +slider.max) * 100;
      slider.style.background =
        "linear-gradient(90deg, var(--red) " + pct + "%, var(--line-strong) " + pct + "%)";
    };
    slider.addEventListener("input", update);
    update();
  })();

  /* ---------------------------------------------------- §10 Roadmap ------ */
  (function roadmap() {
    const ol = $("#roadmap");
    D.ROADMAP.forEach(([n, title, desc]) => {
      const li = el("li", "rmphase");
      const body = el("div", "rmphase__body");
      body.append(el("h3", null, title), el("p", null, desc));
      li.append(el("div", "rmphase__n", "Phase " + n), body);
      ol.appendChild(li);
    });
    // Use of funds
    const fg = $("#fundsGrid");
    D.USE_OF_FUNDS.forEach((f, i) => {
      fg.appendChild(el("div", "fund", "<span>" + String(i + 1).padStart(2, "0") + "</span>" + f));
    });
  })();

  /* ------------------------------------------------- §11 Positioning ----- */
  (function positioning() {
    const g = $("#posGrid");
    D.POSITIONING.forEach(([lead, rest]) => {
      const c = el("article", "pos");
      c.append(el("strong", null, lead), el("p", null, rest));
      g.appendChild(c);
    });
  })();

  /* ---------------------------------------------------- §12 Future ------- */
  (function future() {
    const cloud = $("#futureCloud");
    D.FUTURE.forEach((f, i) => {
      cloud.appendChild(
        el("span", "fchip", "<b>" + String(i + 1).padStart(2, "0") + "</b>" + f)
      );
    });
  })();

  /* ---------------------------------------------------- §13 Privacy ------ */
  (function privacy() {
    const g = $("#privacyGrid");
    D.PRIVACY.forEach(([h, p]) => {
      const c = el("article", "pcard");
      c.append(el("h3", null, h), el("p", null, p));
      g.appendChild(c);
    });
  })();

  /* --------------------------------------------------- Investor modal ---- */
  (function modal() {
    const modalEl = $("#investorModal");
    let lastFocus = null;

    // Populate modal roadmap / table / funds
    const mr = $("#modalRoadmap");
    D.ROADMAP.forEach(([n, title, desc]) => {
      const li = el("li");
      li.innerHTML = "<span><b>" + title + ".</b> " + desc + "</span>";
      mr.appendChild(li);
    });
    const mt = $("#modalTable tbody");
    D.REVENUE_TIERS.forEach((n) => {
      const m = n * D.PRICE;
      const tr = el("tr");
      tr.append(el("td", null, fmt(n)), el("td", null, usd(m)), el("td", null, usd(m * 12)));
      mt.appendChild(tr);
    });
    const mf = $("#modalFunds");
    D.USE_OF_FUNDS.forEach((f) => mf.appendChild(el("span", null, f)));

    const open = () => {
      lastFocus = document.activeElement;
      modalEl.hidden = false;
      document.body.style.overflow = "hidden";
      $(".modal__close", modalEl).focus();
      document.addEventListener("keydown", onKey);
    };
    const close = () => {
      modalEl.hidden = true;
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      if (lastFocus) lastFocus.focus();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const f = $$('button, a[href], input', modalEl).filter((x) => !x.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    $$("[data-open-modal]").forEach((b) => b.addEventListener("click", open));
    $$("[data-close-modal]").forEach((b) => b.addEventListener("click", close));
  })();

  /* ------------------------------------------------------ Theme toggle --- */
  (function theme() {
    const root = document.documentElement;
    const btn = $("#themeToggle");
    const label = $("[data-theme-label]", btn);
    const stored = localStorage.getItem("sac-theme");
    const initial =
      stored ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const apply = (t) => {
      root.setAttribute("data-theme", t);
      label.textContent = t === "dark" ? "Light" : "Dark";
      btn.setAttribute("aria-pressed", String(t === "light"));
      document.querySelector('meta[name="theme-color"]').setAttribute(
        "content",
        t === "dark" ? "#0B0B0C" : "#F4F5F6"
      );
    };
    apply(initial);
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next);
      localStorage.setItem("sac-theme", next);
    });
  })();

  /* ---------------------------------------------- Nav: scroll / progress - */
  (function nav() {
    const nav = $("#nav");
    const progress = $("#progress");
    const burger = $("#burger");
    const links = $(".nav__links");
    const onScroll = () => {
      const y = window.scrollY;
      nav.classList.toggle("is-scrolled", y > 20);
      const h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    burger.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    $$(".nav__links a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("is-open");
        burger.setAttribute("aria-expanded", "false");
      })
    );

    // Back to top
    $("#toTop").addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
    $("#year").textContent = new Date().getFullYear();
  })();

  /* ------------------------------------------------------ Waitlist form -- */
  (function wait() {
    const form = $("#waitform");
    const input = $("#waitEmail");
    const msg = $("#waitMsg");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (!ok) {
        msg.style.color = "var(--red)";
        msg.textContent = "Enter a valid email address.";
        return;
      }
      // PLACEHOLDER: POST to your provider here (Supabase / Mailchimp / ConvertKit).
      msg.style.color = "var(--go)";
      msg.textContent = "✓ You're on the list — we'll be in touch.";
      form.reset();
    });
  })();

  /* -------------------------------------------------- Reveal on scroll --- */
  (function reveal() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window) || !items.length) {
      items.forEach((i) => i.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach((i) => io.observe(i));
  })();

  /* ------------------------- Viewfinder readout micro-animation (hero) --- */
  (function viewfinder() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const isoEl = $('[data-vf="iso"]');
    const shEl = $('[data-vf="shutter"]');
    const evEl = $('[data-vf="ev"]');
    const modeEl = $("#vfMode");
    const tools = $$(".vf__tool");
    const modes = ["CAPTURE", "STUDIO", "SCREEN", "TIMELAPSE", "LAB", "ATTACH"];
    const isos = [100, 200, 400, 800];
    const shutters = ["1/60", "1/125", "1/250", "1/500"];
    let step = 0;
    setInterval(() => {
      step++;
      isoEl.textContent = "ISO " + isos[step % isos.length];
      shEl.textContent = shutters[step % shutters.length];
      const ev = ((step % 5) - 2) * 0.3;
      evEl.textContent = (ev >= 0 ? "+" : "") + ev.toFixed(1);
      const active = step % modes.length;
      modeEl.textContent = modes[active];
      tools.forEach((t, i) => t.classList.toggle("is-active", i === active));
    }, 2200);
  })();

  /* --------------------------- Hero canvas: lens / aperture reticle ------ */
  (function lens() {
    const canvas = $("#lensCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w, h, dpr, cx, cy, R, t = 0, raf;

    const css = (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Anchor the lens to the right side, vertically centered-ish.
      cx = w * (w > 900 ? 0.72 : 0.5);
      cy = h * 0.46;
      R = Math.min(w, h) * (w > 900 ? 0.30 : 0.34);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      const line = css("--line-strong") || "#33363D";
      const mute = css("--ink-mute") || "#8B9298";
      const red = css("--red") || "#E0231C";

      ctx.save();
      ctx.translate(cx, cy);

      // Faint outer rings (lens barrel scales)
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, R * (1.15 + i * 0.12), 0, Math.PI * 2);
        ctx.strokeStyle = line;
        ctx.globalAlpha = 0.35 - i * 0.06;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Focus-distance tick ring (rotating slowly)
      ctx.save();
      ctx.rotate(t * 0.12);
      const ticks = 60;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2;
        const long = i % 5 === 0;
        const r1 = R * 1.1;
        const r2 = R * (long ? 1.02 : 1.06);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.strokeStyle = long ? mute : line;
        ctx.globalAlpha = long ? 0.6 : 0.4;
        ctx.lineWidth = long ? 1.4 : 1;
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // Aperture blades — breathing iris
      const blades = 8;
      const breath = (Math.sin(t * 0.6) + 1) / 2; // 0..1
      const ap = R * (0.36 + breath * 0.30); // aperture opening radius
      ctx.save();
      ctx.rotate(t * 0.05);
      ctx.beginPath();
      for (let i = 0; i <= blades; i++) {
        const a = (i / blades) * Math.PI * 2;
        const na = ((i + 1) / blades) * Math.PI * 2;
        const x1 = Math.cos(a) * R;
        const y1 = Math.sin(a) * R;
        // blade chord control point pushed inward by aperture
        const mx = Math.cos((a + na) / 2) * ap;
        const my = Math.sin((a + na) / 2) * ap;
        if (i === 0) ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, Math.cos(na) * R, Math.sin(na) * R);
      }
      ctx.closePath();
      ctx.strokeStyle = mute;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      // Central glass glow
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ap);
      grad.addColorStop(0, "rgba(224,35,28,0.10)");
      grad.addColorStop(1, "rgba(224,35,28,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, ap, 0, Math.PI * 2);
      ctx.fill();

      // Swiss-cross reticle crosshair
      ctx.strokeStyle = red;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.85;
      const cr = R * 0.14;
      ctx.beginPath(); ctx.moveTo(-cr, 0); ctx.lineTo(cr, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -cr); ctx.lineTo(0, cr); ctx.stroke();
      // little corner brackets around center
      ctx.globalAlpha = 0.5;
      const b = R * 0.42, k = R * 0.08;
      [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(sx * b, sy * b - sy * k);
        ctx.lineTo(sx * b, sy * b);
        ctx.lineTo(sx * b - sx * k, sy * b);
        ctx.strokeStyle = mute;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function loop() {
      t += 0.016;
      draw();
      raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener("resize", () => { resize(); if (reduce) draw(); });
    if (reduce) { draw(); } else { loop(); }

    // Pause the rAF when the hero scrolls off-screen (perf).
    if ("IntersectionObserver" in window && !reduce) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { if (!raf) loop(); }
          else { cancelAnimationFrame(raf); raf = null; }
        });
      }, { threshold: 0 });
      io.observe(canvas);
    }
  })();
})();
