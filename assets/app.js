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
        grid.append(el("div", { class: `panel chip-card is-${tone(r.net)}` },
          el("div", { class: "chip-label" }, el("span", {}, r.name),
            el("span", { class: `chip-tag ${tone(r.net)}` }, r.net > 0 ? "買超" : r.net < 0 ? "賣超" : "持平")),
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
        const label = x.querySelector(".seg-label") || x;
        if (label.textContent !== m.dirs[x.dataset.dir]) label.textContent = m.dirs[x.dataset.dir];
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

  // 文章太長時先收合，避免手機要滑很久才看到新聞
  const COLLAPSE_AT = 900;
  function collapsible(body) {
    const wrap = el("div", { class: "article-body", id: "article-body" }, body);
    const btn = el("button", { type: "button", class: "read-more", "aria-controls": "article-body", "aria-expanded": "false", hidden: true }, "展開全文");
    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") !== "true";
      wrap.classList.toggle("is-collapsed", !open);
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "收合文章" : "展開全文";
      if (!open) $("analysis").scrollIntoView();
    });
    const measure = () => {
      if (wrap.scrollHeight > COLLAPSE_AT && btn.hidden) { wrap.classList.add("is-collapsed"); btn.hidden = false; }
    };
    requestAnimationFrame(measure);
    wrap.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure, { once: true }));
    return [wrap, btn];
  }

  function showPost(posts, idx) {
    const p = posts[idx];
    $("article").replaceChildren(
      el("div", { class: "article-date" }, fmtDate(p.date)),
      el("h3", { class: "article-title" }, p.title || "今日大盤分析"),
      ...collapsible(renderMarkdown(p.content)),
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

  // ---------- 切換按鈕動畫：滑塊移動、像素圖示碎裂重組、邊緣光掃過 ----------
  // 按鈕本身不變（仍是 aria-pressed 的 button），動畫只疊在上面；系統開「減少動態效果」時直接切換。
  const PIXEL_ICONS = {
    bars: ["......##.", "......##.", "...##.##.", "...##.##.", "##.##.##.", "##.##.##.", "##.##.##.", ".........", "#########"],
    pct:  [".##....#.", "#..#..#..", ".##..#...", "....#....", "...#.....", "..#..##..", ".#..#..#.", "#....##..", "........."],
    up:   ["....#....", "...###...", "..#####..", ".#######.", "...###...", "...###...", "...###...", "...###...", "........."],
    down: ["...###...", "...###...", "...###...", "...###...", ".#######.", "..#####..", "...###...", "....#....", "........."],
  };
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function segFx(seg) {
    const buttons = [...seg.querySelectorAll("button")];
    const thumb = el("span", { class: "seg-thumb", "aria-hidden": "true" });
    const canvas = el("canvas", { class: "seg-canvas", "aria-hidden": "true" });
    seg.prepend(thumb);
    seg.append(canvas);
    buttons.forEach((b) => b.prepend(el("span", { class: "seg-icon", "aria-hidden": "true" })));
    const ctx = canvas.getContext("2d");
    const STEP = 2, DOT = 1.5;
    let dpr = 1, centers = [], particles = null, anim = null;
    let active = buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true");

    const dots = (name) => {
      const rows = PIXEL_ICONS[name] || PIXEL_ICONS.bars;
      const out = [];
      rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") out.push([(x - 4) * STEP, (y - 4) * STEP]); }));
      return out;
    };

    function layout() {
      const box = seg.getBoundingClientRect();
      if (!box.width) return false;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      centers = buttons.map((b) => {
        const r = b.querySelector(".seg-icon").getBoundingClientRect();
        return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2];
      });
      placeThumb(!!anim);  // 動畫進行中就讓滑塊繼續滑，不要瞬間跳到終點
      if (!anim) paint();
      return true;
    }

    function placeThumb(animate) {
      const b = buttons[active];
      if (!b) return;
      thumb.classList.toggle("no-anim", !animate);
      thumb.style.width = `${b.offsetWidth}px`;
      thumb.style.transform = `translateX(${b.offsetLeft}px)`;
    }

    const cssVar = (name) => getComputedStyle(seg).getPropertyValue(name).trim();
    function drawDot(x, y, color, alpha, size = DOT) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect((x - size / 2) * dpr, (y - size / 2) * dpr, size * dpr, size * dpr);
    }

    // 靜止狀態：選中的圖示是深色點（在黃色滑塊上），其他是灰點
    function paint(hide = -1, fadeIn = 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      buttons.forEach((b, i) => {
        if (i === hide || !centers[i]) return;
        const on = i === active;
        const disabled = b.disabled;
        dots(b.dataset.icon).forEach(([dx, dy]) =>
          drawDot(centers[i][0] + dx, centers[i][1] + dy, on ? cssVar("--pressed-ink") : cssVar("--muted"), (disabled ? 0.4 : on ? 1 : 0.75) * (on ? 1 : fadeIn)));
      });
      ctx.globalAlpha = 1;
    }

    // 切換：舊圖示碎成粒子，散開後飛到新位置重組成新圖示
    function switchTo(next) {
      const prev = active;
      active = next;
      if (prev === next || prev < 0) { placeThumb(false); paint(); return; }
      placeThumb(!reduceMotion());
      if (reduceMotion() || !centers[prev] || !centers[next]) { paint(); return; }
      thumb.classList.remove("is-switching");
      void thumb.offsetWidth;  // 重新觸發邊緣光動畫
      thumb.classList.add("is-switching");
      thumb.dataset.dir = next > prev ? "right" : "left";
      const from = dots(buttons[prev].dataset.icon), to = dots(buttons[next].dataset.icon);
      const n = Math.max(from.length, to.length);
      particles = Array.from({ length: n }, (_, i) => {
        const a = from[i % from.length], b = to[i % to.length];
        const ang = Math.random() * Math.PI * 2, dist = 6 + Math.random() * 14;
        return {
          sx: centers[prev][0] + a[0], sy: centers[prev][1] + a[1],
          mx: centers[prev][0] + a[0] + Math.cos(ang) * dist, my: centers[prev][1] + a[1] + Math.sin(ang) * dist,
          tx: centers[next][0] + b[0], ty: centers[next][1] + b[1],
          delay: Math.random() * 0.18, fade: i >= to.length,
        };
      });
      const start = performance.now(), DUR = 760;
      cancelAnimationFrame(anim);
      const frame = (now) => {
        const t = Math.min((now - start) / DUR, 1);
        // 新位置原本的灰色圖示先淡出，舊位置的灰色圖示慢慢淡回來
        paint(next, Math.min(1, t * 1.6));
        particles.forEach((p) => {
          const k = Math.min(Math.max((t - p.delay) / (1 - p.delay), 0), 1);
          let x, y;
          if (k < 0.35) { const u = ease(k / 0.35); x = p.sx + (p.mx - p.sx) * u; y = p.sy + (p.my - p.sy) * u; }
          else { const u = ease((k - 0.35) / 0.65); x = p.mx + (p.tx - p.mx) * u; y = p.my + (p.ty - p.my) * u; }
          const landing = k > 0.8;
          const alpha = p.fade ? 1 - k : 1;
          drawDot(x, y, landing ? cssVar("--pressed-ink") : cssVar("--fx-particle"), alpha, landing ? DOT : DOT * 1.15);
        });
        ctx.globalAlpha = 1;
        if (t < 1) anim = requestAnimationFrame(frame);
        else { anim = null; particles = null; paint(); }
      };
      anim = requestAnimationFrame(frame);
    }

    new MutationObserver(() => {
      const next = buttons.findIndex((b) => b.getAttribute("aria-pressed") === "true");
      if (next !== active) switchTo(next); else paint();
    }).observe(seg, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "disabled"] });
    // 方向按鈕的文字會隨排序依據改變（比重上升 ↔ 漲幅最大），寬度變了要重新量
    new MutationObserver(() => layout()).observe(seg, { subtree: true, childList: true, characterData: true });
    if ("ResizeObserver" in window) new ResizeObserver(() => layout()).observe(seg);
    window.addEventListener("resize", () => layout());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());
    document.addEventListener("themechange", () => { if (!anim) paint(); });
    seg.classList.add("fx-ready");
    layout();
  }
  document.querySelectorAll(".seg-fx").forEach(segFx);

  // ---------- 深色／淺色模式切換開關 ----------
  // 參考使用者提供的影片：玻璃滑塊左右滑動，像素月亮／太陽碎成粒子再重組，邊緣光沿框掃一圈，背景跟著變亮變暗。
  // 預設深色；選擇記在瀏覽器（localStorage "theme"），<head> 裡的小程式會在畫面出現前先套用，避免閃一下。
  function pixelShape(kind) {
    const out = [];
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - 5, y - 5);
      let on;
      if (kind === "sun") {
        const ray = (x === 5 && (y <= 1 || y >= 9)) || (y === 5 && (x <= 1 || x >= 9)) ||
          ((x === y || x + y === 10) && (x <= 1 || x >= 9));
        on = d <= 2.7 || ray;
      } else {
        const star = (x === 9 && y >= 0 && y <= 2) || (y === 1 && x >= 8 && x <= 10);
        on = (d <= 4.7 && Math.hypot(x - 7.4, y - 3.3) > 3.5) || star;
      }
      if (on) out.push([x - 5, y - 5]);
    }
    return out;
  }

  function themeToggle(btn) {
    const root = document.documentElement;
    const knob = btn.querySelector(".tt-knob");
    const canvas = btn.querySelector(".tt-canvas");
    const ctx = canvas.getContext("2d");
    const PAD = 14, STEP = 1.7, DOT = 1.35;
    const MOON = pixelShape("moon"), SUN = pixelShape("sun");
    // 圖示顏色看滑塊目前是深色還是淺色：拖到一半還沒放開時，滑塊仍是深色，太陽要用亮色才看得到
    // 拖曳中滑塊會慢慢變白，所以看拖到哪裡決定用亮色還是深色
    const knobIsLight = () => (drag && drag.moved ? k >= 0.5 : !isDark());
    const iconColor = (icon) => (!knobIsLight() ? (icon === "sun" ? "#ffcf5a" : "#eef1ff") : (icon === "sun" ? "#40361f" : "#3c4466"));
    let dpr = 1, anim = null, parts = null;
    let k = 0;            // 圖示變形進度：0 = 月亮（深色），1 = 太陽（淺色）
    let drag = null;      // 拖曳中的狀態
    let suppressClick = false;
    const isDark = () => root.dataset.theme !== "light";

    // ---- 拖曳時背景跟著變：把深色、淺色兩組設計變數依滑塊位置混合 ----
    let tokens = null;
    function parseColor(v) {
      v = v.trim();
      let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (m) {
        const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
        return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
      }
      m = v.match(/^rgba?\(([^)]+)\)$/i);
      if (m) { const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; }
      return null;
    }
    function readTokens() {
      let dark = null, light = null;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.selectorText === ":root" && !dark) dark = r.style;
          if (r.selectorText === ':root[data-theme="light"]') light = r.style;
        }
      }
      if (!dark || !light) return [];
      const out = [];
      for (let i = 0; i < light.length; i++) {
        const name = light[i];
        if (!name.startsWith("--")) continue;
        const a = dark.getPropertyValue(name).trim(), b = light.getPropertyValue(name).trim();
        if (!a || !b) continue;
        const ca = parseColor(a), cb = parseColor(b);
        // 文字類的顏色不混色、過一半才換，不然拖到中間字和背景都是灰的會看不清楚
        const isText = /^--(text|muted|faint|heading|summary|up|down|flat|accent-ink|kind-)/.test(name);
        out.push(ca && cb && !isText ? { name, ca, cb } : { name, a, b });
      }
      return out;
    }
    let mixFrame = 0, mixK = 0;
    function mixTheme(t) {  // t：0 = 深色，1 = 淺色
      mixK = t;
      if (mixFrame) return;
      mixFrame = requestAnimationFrame(() => {
        mixFrame = 0;
        if (!tokens) tokens = readTokens();
        const t2 = mixK;
        tokens.forEach((o) => {
          if (o.ca) {
            const c = o.ca.map((v, i) => v + (o.cb[i] - v) * t2);
            root.style.setProperty(o.name, `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${c[3].toFixed(3)})`);
          } else {
            root.style.setProperty(o.name, t2 < 0.5 ? o.a : o.b);  // 陰影這類沒辦法混的，過一半就換
          }
        });
        root.style.colorScheme = t2 < 0.5 ? "dark" : "light";
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
      });
    }
    function clearMix() {
      cancelAnimationFrame(mixFrame); mixFrame = 0;
      (tokens || []).forEach((o) => root.style.removeProperty(o.name));
      root.style.removeProperty("color-scheme");
    }
    // 邊緣光：拖曳時依位置決定光在框上的哪裡、什麼顏色（深色亮藍 → 中間偏白 → 淺色亮金）
    const lerpRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    const GLOW = { blue: [127, 143, 255], white: [255, 236, 236], gold: [255, 173, 0] };
    const CORE = { blue: [233, 237, 255], white: [255, 255, 255], gold: [255, 243, 194] };
    function setGlow(t) {
      const half = t < 0.5;
      const u = half ? t / 0.5 : (t - 0.5) / 0.5;
      btn.style.setProperty("--arc", `${225 - 180 * t}deg`);
      btn.style.setProperty("--glow", rgb(half ? lerpRGB(GLOW.blue, GLOW.white, u) : lerpRGB(GLOW.white, GLOW.gold, u)));
      btn.style.setProperty("--glow-core", rgb(half ? lerpRGB(CORE.blue, CORE.white, u) : lerpRGB(CORE.white, CORE.gold, u)));
    }
    const clearGlow = () => ["--arc", "--glow", "--glow-core"].forEach((n) => btn.style.removeProperty(n));
    const maxX = () => Math.max(0, btn.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft);

    function knobCenter() {
      const b = btn.getBoundingClientRect(), r = knob.getBoundingClientRect();
      return [r.left - b.left + r.width / 2 + PAD, r.top - b.top + r.height / 2 + PAD];
    }
    function size() {
      const b = btn.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round((b.width + PAD * 2) * dpr);
      canvas.height = Math.round((b.height + PAD * 2) * dpr);
      btn.style.setProperty("--tt-x-max", `${maxX()}px`);
    }
    function dot(x, y, color, alpha, sz = DOT) {
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.fillRect((x - sz / 2) * dpr, (y - sz / 2) * dpr, sz * dpr, sz * dpr);
    }
    // 每次互動重新產生粒子：月亮的點 ↔ 太陽的點，中途散開
    function makeParts() {
      const n = Math.max(MOON.length, SUN.length);
      parts = Array.from({ length: n }, (_, i) => {
        const ang = Math.random() * Math.PI * 2, dist = 5 + Math.random() * 11;
        return { p: MOON[i % MOON.length], q: SUN[i % SUN.length], dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist,
          lag: Math.random() * 0.12, onlyMoon: i >= SUN.length, onlySun: i >= MOON.length };
      });
    }
    // 依進度 k 畫出圖示：k=0 完整月亮、k=1 完整太陽，中間是散開的粒子
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const [cx, cy] = knobCenter();
      if (!parts || k <= 0.001 || k >= 0.999) {
        const icon = k >= 0.5 ? SUN : MOON, color = iconColor(k >= 0.5 ? "sun" : "moon");
        icon.forEach(([x, y]) => dot(cx + x * STEP, cy + y * STEP, color, 1));
        ctx.globalAlpha = 1;
        return;
      }
      parts.forEach((o) => {
        // 每顆粒子稍微錯開時間，看起來是一顆顆散開
        const t = Math.min(Math.max((k - o.lag / 2) / (1 - o.lag), 0), 1);
        const sx = o.p[0] * STEP, sy = o.p[1] * STEP, tx = o.q[0] * STEP, ty = o.q[1] * STEP;
        let x, y;
        if (t < 0.5) { const u = ease(t / 0.5); x = sx + o.dx * u; y = sy + o.dy * u; }
        else { const u = ease((t - 0.5) / 0.5); x = sx + o.dx + (tx - sx - o.dx) * u; y = sy + o.dy + (ty - sy - o.dy) * u; }
        const alpha = o.onlyMoon ? 1 - t : o.onlySun ? t : 1;
        const color = t < 0.2 ? iconColor("moon") : t > 0.8 ? iconColor("sun") : t < 0.5 ? "#a9b4ff" : "#ffb703";
        dot(cx + x, cy + y, color, alpha, t > 0.2 && t < 0.8 ? DOT * 1.2 : DOT);
      });
      ctx.globalAlpha = 1;
    }
    // 讓 k 平滑走到目標值；滑塊本身由 CSS 過場移動，所以每一格都重新取滑塊位置
    function animateK(target, ms) {
      cancelAnimationFrame(anim);
      if (reduceMotion() || ms <= 0) { k = target; anim = null; draw(); return; }
      const from = k, start = performance.now();
      const frame = (now) => {
        const t = Math.min((now - start) / ms, 1);
        k = from + (target - from) * t;
        draw();
        if (t < 1) anim = requestAnimationFrame(frame); else { anim = null; k = target; parts = null; draw(); }
      };
      anim = requestAnimationFrame(frame);
    }
    function sync() {
      const dark = isDark();
      btn.setAttribute("aria-checked", String(dark));
      btn.title = dark ? "深色模式（可拖曳或點一下切換）" : "淺色模式（可拖曳或點一下切換）";
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = dark ? "#0a0d12" : "#f4f5f7";
    }
    function applyTheme(next) {
      if (!reduceMotion()) {
        root.classList.add("theme-anim");
        clearTimeout(applyTheme.t);
        applyTheme.t = setTimeout(() => root.classList.remove("theme-anim"), 650);
        knob.classList.remove("is-switching"); void knob.offsetWidth; knob.classList.add("is-switching");
      }
      if (next === "light") root.dataset.theme = "light"; else delete root.dataset.theme;
      try { localStorage.setItem("theme", next); } catch (e) { /* 無痕模式記不住也沒關係 */ }
      sync();
      document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
    }
    // 點一下或鍵盤：直接切到另一邊
    function setTheme(next) {
      if ((next === "light") === !isDark()) return;
      if (!parts) makeParts();
      applyTheme(next);
      animateK(next === "light" ? 1 : 0, 820 * Math.abs((next === "light" ? 1 : 0) - k) || 820);
    }

    // ---- 拖曳 ----
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelAnimationFrame(anim); anim = null;
      const r = knob.getBoundingClientRect(), b = btn.getBoundingClientRect();
      drag = { id: e.pointerId, startX: e.clientX, knobX: r.left - (b.left + btn.clientLeft) - knob.offsetLeft, moved: false };
      makeParts();
    });
    btn.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(dx) < 4) return;
        drag.moved = true;
        btn.setPointerCapture(e.pointerId);
        btn.classList.add("is-dragging");
      }
      const x = Math.min(Math.max(drag.knobX + dx, 0), maxX());
      knob.style.transform = `translateX(${x}px)`;
      k = maxX() ? x / maxX() : 0;
      if (!reduceMotion()) { mixTheme(k); btn.style.setProperty("--tt-light", k.toFixed(3)); }
      setGlow(k);
      draw();
    });
    const endDrag = (e, cancelled) => {
      if (!drag || e.pointerId !== drag.id) return;
      const wasDrag = drag.moved;
      drag = null;
      if (!wasDrag) return;  // 沒有拖動就當成一般點擊，交給 click 處理
      suppressClick = true;  // 拖曳放開後瀏覽器會補一個 click，略過它
      setTimeout(() => { suppressClick = false; }, 0);
      btn.classList.remove("is-dragging");
      const next = !cancelled && k >= 0.5 ? "light" : (!cancelled ? "dark" : (isDark() ? "dark" : "light"));
      const target = next === "light" ? 1 : 0;
      if (!reduceMotion()) {
        root.classList.add("theme-anim");
        clearTimeout(applyTheme.t);
        applyTheme.t = setTimeout(() => root.classList.remove("theme-anim"), 650);
      }
      clearMix();
      btn.style.removeProperty("--tt-light");
      clearGlow();  // 交還給 CSS，光會從放開的位置沿著框滑到定位
      if ((next === "light") !== !isDark()) applyTheme(next);
      else sync();
      knob.style.transform = "";  // 交還給 CSS，滑塊會從放開的位置滑到定位
      animateK(target, Math.max(220, 620 * Math.abs(target - k)));
    };
    btn.addEventListener("pointerup", (e) => endDrag(e, false));
    btn.addEventListener("pointercancel", (e) => endDrag(e, true));

    btn.addEventListener("click", () => {
      if (suppressClick) { suppressClick = false; return; }
      setTheme(isDark() ? "light" : "dark");
    });
    // 鍵盤：左右方向鍵也能切換（空白鍵、Enter 是按鈕原本就支援的點擊）
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); setTheme("light"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setTheme("dark"); }
    });

    k = isDark() ? 0 : 1;
    size(); sync(); draw();
    window.addEventListener("resize", () => { size(); draw(); });
    btn.classList.add("tt-ready");
  }
  const ttBtn = document.getElementById("theme-toggle");
  if (ttBtn) themeToggle(ttBtn);

  // 選單標出目前捲到的區塊
  function watchSections() {
    if (!("IntersectionObserver" in window)) return;
    const links = [...document.querySelectorAll(".nav a[href^='#']")];
    const map = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target.id, e.isIntersecting));
      const current = [...map.keys()].find((id) => seen.get(id));
      links.forEach((a) => a.setAttribute("aria-current", String(a === map.get(current))));
    }, { rootMargin: "-70px 0px -55% 0px" });
    map.forEach((_, id) => { const sec = document.getElementById(id); if (sec) io.observe(sec); });
  }

  tickClock();
  watchSections();
  setInterval(tickClock, 30 * 1000);
  loadJSON("data/chips.json").then(renderChips).catch(fail("chips-grid", "籌碼資料讀取失敗，請稍後重新整理。"));
  loadSectors();
  loadJSON("data/analysis.json").then(renderAnalysis).catch(fail("article", "大盤分析讀取失敗，請稍後重新整理。"));
  loadJSON("data/news.json").then(renderNews).catch(fail("news-list", "新聞讀取失敗，請稍後重新整理。"));
  loadJSON("data/media.json").then(renderMedia).catch(fail("yt-list", "節目資料讀取失敗，請稍後重新整理。"));
})();
