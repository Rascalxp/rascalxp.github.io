(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  async function loadJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  const fmtInt = (n) => Math.abs(n).toLocaleString("zh-TW");
  const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtInt(n);
  const toYi = (n) => n / 1e8;
  const signedYi = (n) => {
    const v = toYi(n);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
  };
  const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
  // 散戶是反指標：增加顯示綠、減少顯示紅
  const toneReverse = (n) => (n > 0 ? "down" : n < 0 ? "up" : "flat");

  function fmtTime(iso) {
    if (!iso) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(5).replace("-", "/"); // 只有日期
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }
  const fmtDate = (s) => (s ? s.replace(/-/g, "/") : "");

  function tickClock() {
    $("clock").textContent = new Date().toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }

  // ---------- 01 籌碼 ----------
  function renderChips(data) {
    const grid = $("chips-grid");
    grid.replaceChildren();
    const inst = data && data.institutional;
    if (!inst) {
      grid.append(el("div", { class: "panel empty", style: "grid-column: 1 / -1" },
        "籌碼資料尚未更新，收盤後會自動抓取。"));
    } else {
      $("chips-meta").textContent = `資料日期 ${fmtDate(inst.date)}`;
      for (const r of inst.rows) {
        const total = r.buy + r.sell;
        const buyPct = total > 0 ? (r.buy / total) * 100 : 50;
        grid.append(el("div", { class: "panel chip-card" },
          el("div", { class: "chip-label" }, el("span", {}, r.name), el("span", {}, r.net > 0 ? "買超" : r.net < 0 ? "賣超" : "持平")),
          el("div", { class: `chip-value num ${tone(r.net)}` }, signedYi(r.net), el("small", {}, "億")),
          el("div", { class: "chip-bar", title: `買進占 ${buyPct.toFixed(1)}%` }, el("span", { style: `width:${buyPct}%` })),
          el("div", { class: "chip-sub num" },
            el("span", {}, `買 ${toYi(r.buy).toFixed(2)}`),
            el("span", {}, `賣 ${toYi(r.sell).toFixed(2)}`)),
        ));
      }
    }

    const tmf = data && data.retail_tmf;
    const card = $("retail-card");
    if (tmf) {
      card.hidden = false;
      const change = tmf.change == null
        ? el("span", { class: "flat" }, "—")
        : el("span", { class: toneReverse(tmf.change) }, signed(tmf.change));
      card.replaceChildren(
        el("div", {},
          el("div", { class: "retail-title" }, "散戶微台", el("span", { class: "badge" }, "反指標")),
          el("div", { class: "muted", style: "font-size:13px" }, "口數增減（淨未平倉）")),
        el("div", { class: "retail-value num" },
          change,
          el("span", { class: "paren" }, "（"),
          el("span", { class: toneReverse(tmf.net_oi) }, signed(tmf.net_oi)),
          el("span", { class: "paren" }, "）")),
        el("div", { class: "retail-note" },
          `資料日期 ${fmtDate(tmf.date)}`,
          tmf.prev_date ? el("br") : null,
          tmf.prev_date ? `與 ${fmtDate(tmf.prev_date)} 比較` : null),
      );
    }
    if (data && data.updated) {
      $("chips-meta").textContent += `　更新 ${fmtTime(data.updated)}`;
    }
  }

  // ---------- 02 類股成交比重 ----------
  const signedPct = (n, digits = 2) =>
    n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(digits);
  const fmtNum = (n, digits) => n.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const yi = (n, digits = 1) => (n == null ? "—" : fmtNum(n / 1e8, digits));
  // 個股成交金額：1 億以上用「億」，以下用「萬」，避免小金額顯示成 0.00 億
  const money = (n) => (n >= 1e8 ? `${fmtNum(n / 1e8, 2)} 億` : `${fmtNum(n / 1e4, 0)} 萬`);
  const growth = (now, prev) => (now != null && prev ? (now / prev - 1) * 100 : null);

  const TOP_SECTORS = 6;   // 只列 6 類
  const MIN_VALUE = 1e7;   // 漲幅前五只看成交 1,000 萬以上（後端也有過濾，這裡是舊資料的保險）
  const PREF = { sort: "sectorSort", dir: "sectorDir", stocks: "sectorStocks" };
  // 紅綠只用在價格（漲跌）。成交比重和成交金額的增減不是多空訊號，用中性色。
  // 長條固定刻度：漲跌幅以漲跌停 ±10% 為滿格，比重增減以 ±2 個百分點為滿格，不同天才能互相比較
  const MODES = {
    flow: {
      label: "成交比重增減", short: "比重增減", unit: "百分點", scale: 2, priced: false,
      dirs: { top: "比重上升", bottom: "比重下降" },
      value: (s) => s.share_change,
    },
    change: {
      label: "漲跌幅", short: "漲跌幅", unit: "%", scale: 10, priced: true,
      dirs: { top: "漲幅最大", bottom: "跌幅最大" },
      value: (s) => s.change_pct,
    },
  };

  function readPref(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 無痕模式等情況不記也沒關係 */ }
  }

  function stockTable(list) {
    return el("table", { class: "top5" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "代號"), el("th", { scope: "col" }, "名稱"), el("th", { scope: "col", class: "r" }, "收盤"),
        el("th", { scope: "col", class: "r hide-sm" }, "漲跌"), el("th", { scope: "col", class: "r" }, "漲跌幅"),
        el("th", { scope: "col", class: "r" }, "成交金額"))),
      el("tbody", {}, list.map((t, i) => el("tr", {},
        el("td", { class: "num" }, el("span", { class: "rank" }, i + 1), t.code),
        el("td", {}, t.name, t.limit_up ? el("span", { class: "limit" }, "漲停") : null),
        el("td", { class: "r num" }, fmtNum(t.close, 2)),
        el("td", { class: `r num hide-sm ${tone(t.change)}` }, signedPct(t.change)),
        el("td", { class: `r num ${tone(t.change_pct)}` }, signedPct(t.change_pct) + "%"),
        el("td", { class: "r num" }, money(t.value)),
      ))));
  }

  // 展開後的個股清單：漲幅前五（有成交門檻）或成交前五大
  function renderStocks(s, view) {
    if (view === "value") {
      if (!s.top_value) return [el("p", { class: "detail-note" }, "成交前五大會在下次資料更新後出現。")];
      if (!s.top_value.length) return [el("p", { class: "detail-note" }, "這個類股今天沒有成交資料。")];
      return [el("p", { class: "detail-note" }, "依當天成交金額排序，代表錢真正交易最多的個股。"), stockTable(s.top_value)];
    }
    const list = s.top.filter((t) => t.value >= MIN_VALUE);
    if (!list.length) return [el("p", { class: "detail-note" }, "今天沒有成交 1,000 萬元以上的個股。")];
    const notes = ["只列成交 1,000 萬元以上的個股。"];
    if (list.every((t) => t.change_pct <= 0)) notes.push("今天沒有上漲的個股，以下是跌幅最小的幾檔。");
    return [el("p", { class: "detail-note" }, notes.join("")), stockTable(list)];
  }

  // 類股指數和多數個股方向明顯相反時（例如指數漲、但多數個股跌）補一句說明。
  // 指數依市值加權，所以只在成交金額最大的個股占一半以上、而且和指數同方向時才點名。
  const dominant = (s) => s.leader && s.leader.value_share >= 50 ? s.leader : null;
  function breadthNote(s) {
    if (Math.abs(s.change_pct) < 0.3) return null;
    const rising = s.change_pct > 0;
    if (rising ? s.down <= s.up : s.up <= s.down) return null;
    const parts = [
      `類股指數${rising ? "上漲" : "下跌"}，但多數個股${rising ? "下跌" : "上漲"}（${s.up} 漲、${s.down} 跌）。`,
      "類股指數依市值加權，主要反映權值股的表現。",
    ];
    const L = dominant(s);
    if (L && Math.sign(L.change_pct) === Math.sign(s.change_pct)) {
      parts.push(`成交金額最大的${L.name}（${signedPct(L.change_pct)}%）就占類股成交 ${L.value_share}%。`);
    }
    return el("p", { class: "detail-note" }, parts.join(""));
  }

  function sectorLabel(s, rank) {
    const g = growth(s.value, s.prev_value);
    const L = dominant(s);
    return [
      `第 ${rank} 名 ${s.name}`,
      `成交比重增減 ${signedPct(s.share_change)} 個百分點`,
      `漲跌幅 ${signedPct(s.change_pct)}%`,
      `成交金額 ${yi(s.value)} 億` + (g == null ? "" : `，比前一日 ${signedPct(g, 0)}%`),
      s.share == null ? "" : `成交比重 ${s.share.toFixed(2)}%`,
      `${s.up} 檔上漲、${s.down} 檔下跌`,
      L ? `${L.name}占類股成交 ${Math.round(L.value_share)}%` : "",
    ].filter(Boolean).join("，");
  }

  function sectorBar(v, m) {
    const ratio = v == null ? 0 : Math.abs(v) / m.scale;
    const w = Math.min(ratio, 1) * 50;
    const side = v >= 0 ? "pos" : "neg";
    return el("span", { class: "pct-bar", "aria-hidden": "true" }, el("span", {
      class: [side, m.priced ? "" : "neutral", ratio > 1 ? "capped" : ""].join(" ").trim(),
      style: v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`,
    }));
  }

  function renderSectors(data) {
    const list = $("sector-list");
    const sectors = (data && data.sectors) || [];
    if (!sectors.length) {
      list.replaceChildren(el("li", { class: "empty" }, "類股資料尚未更新，每個交易日收盤後（約 15:15～16:30）會自動抓取。"));
      return;
    }
    $("sectors-meta").replaceChildren(
      el("span", {}, `資料日期 ${fmtDate(data.date)}`),
      data.prev_date ? el("span", {}, `與 ${fmtDate(data.prev_date)} 比較`) : "",
      data.updated ? el("span", {}, `更新 ${fmtTime(data.updated)}`) : "",
    );

    const up = sectors.filter((s) => s.change_pct > 0).length;
    const down = sectors.filter((s) => s.change_pct < 0).length;
    const hasFlow = sectors.some((s) => s.share_change != null);
    const totalGrowth = growth(data.total_value, data.prev_total_value);
    const stat = (label, ...value) => el("div", { class: "stat" }, el("dt", {}, label), el("dd", {}, ...value));
    const note = (label, text) => el("div", { class: "stat stat-note" }, el("dt", {}, label), el("dd", { class: "muted" }, text));
    $("sector-summary").replaceChildren(
      data.taiex ? stat("加權指數", el("b", { class: `num ${tone(data.taiex.change_pct)}` }, signedPct(data.taiex.change_pct) + "%")) : "",
      data.total_value ? stat("類股成交合計",
        el("b", { class: "num" }, yi(data.total_value, 0), el("small", {}, " 億")),
        totalGrowth == null ? "" : el("small", { class: "num growth" }, ` 比前一日 ${signedPct(totalGrowth, 1)}%`)) : "",
      stat(`${sectors.length} 類漲跌`, el("b", { class: "num" }, el("span", { class: "up" }, `${up} 漲`), " ", el("span", { class: "down" }, `${down} 跌`))),
      hasFlow ? "" : note("成交比重增減", "缺前一交易日資料，暫時只能看漲跌幅"),
    );

    let mode = readPref(PREF.sort) === "change" || !hasFlow ? "change" : "flow";
    let dir = readPref(PREF.dir) === "bottom" ? "bottom" : "top";
    let stocksView = readPref(PREF.stocks) === "value" ? "value" : "gain";
    const open = new Set();
    const modeBtns = document.querySelectorAll("#sectors [data-sort]");
    const dirBtns = document.querySelectorAll("#sectors [data-dir]");
    const flowBtn = document.querySelector('#sectors [data-sort="flow"]');
    flowBtn.disabled = !hasFlow;
    $("sector-controls").hidden = false;

    // 比重是相對值：整體成交變多時，比重下降的類股成交金額也可能增加
    function hint() {
      if (mode !== "flow") return "";
      const total = totalGrowth == null ? "" : `今天類股成交合計比前一日 ${signedPct(totalGrowth, 1)}%，`;
      return `${total}比重是相對值，比重下降的類股成交金額仍可能增加；它代表成交往哪裡集中，不是買賣超。`;
    }

    // 符合方向的類股不到 6 類時（例如大跌日只有 2 類上漲），在中間加分隔說明
    function divider(rows, m) {
      const sign = dir === "top" ? 1 : -1;
      const k = rows.filter((s) => sign * m.value(s) > 0).length;
      if (k >= rows.length) return null;
      const word = m.priced ? (dir === "top" ? "上漲" : "下跌") : (dir === "top" ? "比重上升" : "比重下降");
      const text = k === 0
        ? `今天沒有${word}的類股，以下是最接近的 ${rows.length} 類`
        : `今天只有 ${k} 類${word}，以下是最接近的類股`;
      return { at: k, node: el("li", { class: "sector-divider" }, text) };
    }

    function stocksToggle(s) {
      const make = (view, label) => el("button", { type: "button", "data-stocks": view, "aria-pressed": String(stocksView === view) }, label);
      const box = el("div", { class: "seg seg-sm", role: "group", "aria-label": `${s.name}個股清單` },
        make("gain", "漲幅前五"), make("value", "成交前五大"));
      box.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.dataset.stocks === stocksView) return;
        stocksView = b.dataset.stocks;
        savePref(PREF.stocks, stocksView);
        draw(false, `[data-sector="${s.name}"] [data-stocks="${stocksView}"]`);
      });
      return box;
    }

    function draw(announce, refocus) {
      const m = MODES[mode];
      const other = MODES[mode === "flow" ? "change" : "flow"];
      const sign = dir === "top" ? 1 : -1;
      // 同分時成交金額大的排前面
      const rows = sectors.filter((s) => m.value(s) != null)
        .sort((a, b) => sign * (m.value(b) - m.value(a)) || (b.value || 0) - (a.value || 0))
        .slice(0, TOP_SECTORS);
      modeBtns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.sort === mode)));
      dirBtns.forEach((x) => {
        x.textContent = m.dirs[x.dataset.dir];
        x.setAttribute("aria-pressed", String(x.dataset.dir === dir));
      });
      $("sector-hint").textContent = hint();
      $("sector-hint").hidden = !hint();
      if (announce) $("sector-status").textContent = `已改為依${m.label}，列出${m.dirs[dir]}的 ${rows.length} 類`;

      const head = el("li", { class: "sector-row sector-head", "aria-hidden": "true" },
        el("span", {}, "#"), el("span", {}, "類股"),
        el("span", { class: "active" }, `${m.label}（${m.unit}）`),
        el("span", { class: "r" }, "成交金額（億）／比前一日"), el("span", { class: "r" }, "成交比重"),
        el("span", { class: "r" }, `${other.short}（${other.unit}）`), el("span", {}));

      const items = rows.map((s, i) => {
        const id = `sector-detail-${i}`;
        const v = m.value(s);
        const ov = other.value(s);
        const g = growth(s.value, s.prev_value);
        const L = dominant(s);
        const isOpen = open.has(s.name);
        const btn = el("button", {
          type: "button", class: "sector-row", "aria-expanded": String(isOpen), "aria-controls": id,
          "aria-label": sectorLabel(s, i + 1),
        },
          el("span", { class: "num rank-no" }, i + 1),
          el("span", { class: "sector-name" },
            el("b", {}, s.name),
            el("small", { class: "num" }, el("span", { class: "up" }, `${s.up} 漲`), " ", el("span", { class: "down" }, `${s.down} 跌`),
              L ? el("span", { class: "lead-tag" }, `${L.name}占 ${Math.round(L.value_share)}%`) : null)),
          el("span", { class: "sector-hero" },
            sectorBar(v, m),
            el("b", { class: `num ${m.priced ? tone(v) : ""}` }, m.priced ? signedPct(v) + "%" : signedPct(v),
              m.priced ? null : el("small", { class: "unit" }, " 百分點"))),
          el("span", { class: "sector-sub" },
            el("span", { class: "r num cell-value" }, el("span", { class: "lbl" }, "成交 "), yi(s.value),
              el("small", { class: "unit" }, " 億"),
              g == null ? null : el("small", { class: "growth" }, el("span", { class: "unit" }, " 比前一日"), ` ${signedPct(g, 0)}%`)),
            el("span", { class: "r num cell-share" }, el("span", { class: "lbl" }, "比重 "), s.share == null ? "—" : `${s.share.toFixed(2)}%`),
            el("span", { class: `r num cell-other ${other.priced ? tone(ov) : ""}` },
              el("span", { class: "lbl" }, `${other.short} `),
              other.priced ? signedPct(ov) + "%" : signedPct(ov),
              other.priced ? null : el("small", { class: "unit" }, " 百分點"))),
          el("span", { class: "chev", "aria-hidden": "true" }),
        );
        const detail = el("div", { class: "sector-detail", id, hidden: !isOpen },
          el("div", { class: "detail-head" },
            el("span", {}, s.name, el("span", { class: "muted" }, `　共 ${s.count} 檔`)),
            stocksToggle(s)),
          breadthNote(s),
          ...renderStocks(s, stocksView));
        btn.addEventListener("click", () => {
          const now = btn.getAttribute("aria-expanded") !== "true";
          btn.setAttribute("aria-expanded", String(now));
          detail.hidden = !now;
          if (now) open.add(s.name); else open.delete(s.name);
        });
        return el("li", { "data-sector": s.name }, btn, detail);
      });
      const d = divider(rows, m);
      if (d && d.at > 0) items.splice(d.at, 0, d.node);
      else if (d) items.unshift(d.node);
      list.replaceChildren(head, ...items);
      if (refocus) { const f = list.querySelector(refocus); if (f) f.focus(); }
    }

    modeBtns.forEach((b) => {
      b.onclick = () => {
        if (b.disabled || b.dataset.sort === mode) return;
        mode = b.dataset.sort;
        savePref(PREF.sort, mode);
        draw(true);
      };
    });
    dirBtns.forEach((b) => {
      b.onclick = () => {
        if (b.dataset.dir === dir) return;
        dir = b.dataset.dir;
        savePref(PREF.dir, dir);
        draw(true);
      };
    });
    draw(false);
  }

  function loadSectors() {
    const list = $("sector-list");
    $("sector-controls").hidden = true;
    $("sector-hint").hidden = true;
    list.replaceChildren(el("li", { class: "empty" }, "資料載入中…"));
    loadJSON("data/sectors.json").then(renderSectors).catch((err) => {
      console.error(err);
      const retry = el("button", { type: "button", class: "retry" }, "重試");
      retry.addEventListener("click", loadSectors);
      list.replaceChildren(el("li", { class: "empty" }, "類股資料讀取失敗，可能是網路不穩。", el("br"), retry));
      $("sector-status").textContent = "類股資料讀取失敗，可以按重試";
    });
  }

  // ---------- 03 大盤分析 ----------
  // 條列、編號、引言和一般段落之間自動補空行。Markdown 規定要空一行才會分開，
  // 不然清單後面那段會被併進最後一項、段落後面的「2. 」也不會變成編號。
  function separateBlocks(md) {
    const group = (l) => {
      if (!l.trim()) return "blank";
      if (/^\s{2,}\S/.test(l)) return "cont";
      if (/^([-*]|\d+\.) /.test(l)) return "list";
      if (/^>/.test(l)) return "quote";
      if (/^#{1,6} /.test(l)) return "heading";
      return "text";
    };
    const out = [];
    let prev = "blank";
    for (const line of (md || "").split("\n")) {
      let g = group(line);
      if (g === "cont") g = prev;
      const blockish = (x) => x === "list" || x === "quote";
      if (prev !== "blank" && g !== "blank" && g !== prev && (blockish(prev) || blockish(g))) out.push("");
      out.push(line);
      prev = g;
    }
    return out.join("\n");
  }

  function renderMarkdown(md) {
    const html = window.marked ? window.marked.parse(separateBlocks(md), { breaks: true }) : md;
    const safe = window.DOMPurify ? window.DOMPurify.sanitize(html) : "";
    const div = el("div", { class: "md" });
    div.innerHTML = safe;
    div.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
    div.querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.title = "點一下放大";
      img.addEventListener("click", () => openLightbox(img));
      img.addEventListener("keydown", (e) => { if (e.key === "Enter") openLightbox(img); });
    });
    return div;
  }

  // ---------- 圖片放大檢視 ----------
  // 點文章裡的圖片：全螢幕顯示；在大圖上點一下切換放大（可拖曳移動），手機也能雙指縮放。
  // 關閉：右上角 ×、點黑色背景、Esc，或手機的「返回」。
  let lightbox = null;

  function closeLightbox(fromHistory) {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    document.documentElement.classList.remove("lightbox-on");
    if (!fromHistory && history.state && history.state.lightbox) history.back();
  }

  function openLightbox(src) {
    closeLightbox();
    const big = el("img", { src: src.currentSrc || src.src, alt: src.alt || "" });
    const stage = el("div", { class: "lb-stage" }, big);
    const caption = src.alt ? el("div", { class: "lb-caption" }, src.alt) : null;
    const hint = el("div", { class: "lb-hint" }, "點圖片放大／縮小，雙指可縮放");
    const closeBtn = el("button", { class: "lb-close", type: "button", "aria-label": "關閉" }, "×");
    lightbox = el("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": src.alt || "圖片" },
      stage, caption, hint, closeBtn);
    document.body.append(lightbox);
    document.documentElement.classList.add("lightbox-on");
    history.pushState({ lightbox: true }, "");
    closeBtn.focus();

    closeBtn.addEventListener("click", () => closeLightbox());
    stage.addEventListener("click", (e) => {
      if (e.target !== big) {
        if (!stage.classList.contains("zoomed")) closeLightbox();
        return;
      }
      if (stage.classList.contains("zoomed")) {
        stage.classList.remove("zoomed");
        big.style.width = "";
        return;
      }
      // 以點擊位置為中心放大
      const rect = big.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      const ry = (e.clientY - rect.top) / rect.height;
      const width = Math.max(rect.width * 2.5, Math.min(big.naturalWidth, window.innerWidth * 3));
      stage.classList.add("zoomed");
      big.style.width = `${width}px`;
      stage.scrollLeft = rx * big.offsetWidth - stage.clientWidth / 2 + big.offsetLeft;
      stage.scrollTop = ry * big.offsetHeight - stage.clientHeight / 2 + big.offsetTop;
    });
  }

  window.addEventListener("popstate", () => closeLightbox(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  function showPost(posts, idx) {
    const p = posts[idx];
    $("article").replaceChildren(
      el("div", { class: "article-date" }, fmtDate(p.date)),
      el("h3", { class: "article-title" }, p.title || "今日大盤分析"),
      renderMarkdown(p.content),
    );
    $("archive-list").querySelectorAll("button").forEach((b, i) => {
      b.setAttribute("aria-current", i === idx ? "true" : "false");
    });
    $("analysis-meta").textContent = p.updated ? `更新 ${fmtTime(p.updated)}` : "";
  }

  function renderAnalysis(data) {
    const posts = ((data && data.posts) || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!posts.length) {
      $("article").replaceChildren(el("div", { class: "empty" }, "還沒有大盤分析，敬請期待。"));
      return;
    }
    const list = $("archive-list");
    list.replaceChildren(...posts.slice(0, 60).map((p, i) => el("li", {},
      el("button", { type: "button", "data-i": i },
        el("span", { class: "d" }, fmtDate(p.date)),
        el("span", {}, p.title || "大盤分析")))));
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      showPost(posts, Number(b.dataset.i));
      $("analysis").scrollIntoView();
    });
    $("archive").hidden = posts.length < 2;
    showPost(posts, 0);
  }

  // ---------- 04 新聞 ----------
  function renderNews(data) {
    const list = $("news-list");
    const items = (data && data.items) || [];
    if (!items.length) {
      list.replaceChildren(el("li", { class: "empty" }, "新聞尚未更新。"));
      return;
    }
    $("news-meta").textContent = data.updated ? `更新 ${fmtTime(data.updated)}` : "";
    list.replaceChildren(...items.map((n) => el("li", { class: "news-item" },
      el("div", {},
        el("a", { class: "news-title", href: n.url, target: "_blank", rel: "noopener" }, n.title),
        el("div", { class: "news-meta" }, [n.source, fmtTime(n.published)].filter(Boolean).join("・")),
        n.summary ? el("p", { class: "news-summary" }, n.summary) : null,
        n.tags && n.tags.length ? el("div", { class: "tags" }, n.tags.map((t) => el("span", { class: "tag" }, t))) : null,
      ))));
    $("ai-note").textContent = data.ai_summary
      ? "摘要由 AI 依新聞標題與內文片段整理，可能有疏漏，請以原文為準。"
      : "";
  }

  const KIND_LABEL = { youtube: "YouTube", podcast: "Podcast" };

  function renderMedia(data) {
    const box = $("yt-list");
    const channels = (data && data.sources) || [];
    if (!channels.length) {
      box.replaceChildren(el("div", { class: "panel empty" }, "節目資料尚未更新。"));
      return;
    }
    $("yt-meta").textContent = data.updated ? `更新 ${fmtTime(data.updated)}` : "";
    box.replaceChildren(...channels.map((ch) => el("div", { class: "panel yt-channel" },
      el("h4", {},
        el("span", {},
          el("span", { class: `kind kind-${ch.kind}` }, KIND_LABEL[ch.kind] || ""),
          el("a", { href: ch.url, target: "_blank", rel: "noopener" }, ch.name)),
        el("a", { class: "more", href: ch.url, target: "_blank", rel: "noopener" },
          ch.kind === "podcast" ? "前往節目 →" : "前往頻道 →")),
      ch.items.map((v) => el("div", { class: "yt-video" },
        el("a", { class: `yt-thumb${ch.kind === "podcast" ? " square" : ""}`, href: v.url, target: "_blank", rel: "noopener", "aria-label": v.title },
          el("img", { src: v.thumbnail, alt: "", loading: "lazy", width: 320, height: 180 })),
        el("div", {},
          el("a", { class: "yt-title", href: v.url, target: "_blank", rel: "noopener" }, v.title),
          el("div", { class: "yt-date" }, fmtTime(v.published)),
          v.description
            ? el("details", { class: "yt-desc" },
                el("summary", {}, v.description.slice(0, 40) + (v.description.length > 40 ? "…" : "")),
                el("p", {}, v.description))
            : null,
        ))),
    )));
  }

  function fail(boxId, msg) {
    return (err) => {
      console.error(err);
      const box = $(boxId);
      box.replaceChildren(el(/^(OL|UL)$/.test(box.tagName) ? "li" : "div", { class: "empty" }, msg));
    };
  }

  tickClock();
  setInterval(tickClock, 30 * 1000);
  loadJSON("data/chips.json").then(renderChips).catch(fail("chips-grid", "籌碼資料讀取失敗，請稍後重新整理。"));
  loadSectors();
  loadJSON("data/analysis.json").then(renderAnalysis).catch(fail("article", "大盤分析讀取失敗，請稍後重新整理。"));
  loadJSON("data/news.json").then(renderNews).catch(fail("news-list", "新聞讀取失敗，請稍後重新整理。"));
  loadJSON("data/media.json").then(renderMedia).catch(fail("yt-list", "節目資料讀取失敗，請稍後重新整理。"));
})();
