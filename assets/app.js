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

  // ---------- 02 類股資金流向 ----------
  const signedPct = (n, digits = 2) =>
    n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(digits);
  const fmtNum = (n, digits) => n.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const yi = (n, digits = 1) => (n == null ? "—" : fmtNum(n / 1e8, digits));
  const growth = (now, prev) => (now != null && prev ? (now / prev - 1) * 100 : null);

  const TOP_SECTORS = 6;   // 只列前 6 名類股
  const SORT_KEY = "sectorSort";
  // 長條固定刻度：漲跌幅以漲跌停 ±10% 為滿格，比重增減以 ±2 個百分點為滿格，不同天才能互相比較
  const MODES = {
    flow: {
      label: "成交比重增減", unit: "百分點", scale: 2,
      value: (s) => s.share_change, sort: (a, b) => (b.share_change ?? -Infinity) - (a.share_change ?? -Infinity),
    },
    change: {
      label: "漲跌幅", unit: "%", scale: 10,
      value: (s) => s.change_pct, sort: (a, b) => b.change_pct - a.change_pct,
    },
  };

  function readSort() {
    try { return localStorage.getItem(SORT_KEY); } catch (e) { return null; }
  }
  function saveSort(key) {
    try { localStorage.setItem(SORT_KEY, key); } catch (e) { /* 無痕模式等情況不記也沒關係 */ }
  }

  function renderSectorTop(s) {
    if (!s.top.length) return el("p", { class: "detail-note" }, "這個類股今天沒有成交資料。");
    return el("table", { class: "top5" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "代號"), el("th", { scope: "col" }, "名稱"), el("th", { scope: "col", class: "r" }, "收盤"),
        el("th", { scope: "col", class: "r hide-sm" }, "漲跌"), el("th", { scope: "col", class: "r" }, "漲跌幅"),
        el("th", { scope: "col", class: "r" }, "成交（億）"))),
      el("tbody", {}, s.top.map((t, i) => el("tr", {},
        el("td", { class: "num" }, el("span", { class: "rank", "aria-label": `第 ${i + 1} 名` }, i + 1), t.code),
        el("td", {}, t.name, t.limit_up ? el("span", { class: "limit" }, "漲停") : null),
        el("td", { class: "r num" }, fmtNum(t.close, 2)),
        el("td", { class: `r num hide-sm ${tone(t.change)}` }, signedPct(t.change)),
        el("td", { class: `r num ${tone(t.change_pct)}` }, signedPct(t.change_pct) + "%"),
        el("td", { class: "r num" }, yi(t.value, 2)),
      ))));
  }

  // 類股指數和多數個股方向相反時（例如指數漲、但多數個股跌），補一句說明
  function breadthNote(s) {
    const diverge = (s.change_pct > 0 && s.down > s.up) || (s.change_pct < 0 && s.up > s.down);
    if (!diverge) return null;
    const dir = s.change_pct > 0 ? "上漲" : "下跌";
    const most = s.change_pct > 0 ? `多數個股下跌（${s.up} 漲、${s.down} 跌）` : `多數個股上漲（${s.up} 漲、${s.down} 跌）`;
    const lead = s.leader
      ? `成交最大的是${s.leader.name}（${signedPct(s.leader.change_pct)}%），占類股成交 ${s.leader.value_share}%。`
      : "";
    return el("p", { class: "detail-note" }, `類股指數${dir}，但${most}。${lead}`);
  }

  function sectorLabel(s) {
    return [
      s.name,
      `成交比重增減 ${signedPct(s.share_change)} 個百分點`,
      `漲跌幅 ${signedPct(s.change_pct)}%`,
      `成交金額 ${yi(s.value)} 億` + (growth(s.value, s.prev_value) == null ? "" : `，比前一日 ${signedPct(growth(s.value, s.prev_value), 0)}%`),
      s.share == null ? "" : `成交比重 ${s.share.toFixed(2)}%`,
      `上漲 ${s.up} 檔、下跌 ${s.down} 檔`,
    ].filter(Boolean).join("，");
  }

  function sectorBar(v, scale) {
    const w = v == null ? 0 : Math.min(Math.abs(v) / scale, 1) * 50;
    return el("span", { class: "pct-bar", "aria-hidden": "true" }, el("span", {
      class: v >= 0 ? "pos" : "neg",
      style: v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`,
    }));
  }

  function renderSectors(data) {
    const list = $("sector-list");
    const sectors = (data && data.sectors) || [];
    const buttons = document.querySelectorAll("#sectors .seg button");
    if (!sectors.length) {
      list.replaceChildren(el("li", { class: "empty" }, "類股資料尚未更新，收盤後會自動抓取。"));
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
    const drop = hasFlow ? sectors.slice().sort((a, b) => (a.share_change ?? Infinity) - (b.share_change ?? Infinity))[0] : null;
    const totalGrowth = growth(data.total_value, data.prev_total_value);
    const stat = (label, ...value) => el("div", { class: "stat" }, el("dt", {}, label), el("dd", {}, ...value));
    $("sector-summary").replaceChildren(
      data.taiex ? stat("加權指數", el("b", { class: `num ${tone(data.taiex.change_pct)}` }, signedPct(data.taiex.change_pct) + "%")) : "",
      data.total_value ? stat("上市成交",
        el("b", { class: "num" }, yi(data.total_value, 0), el("small", {}, " 億")),
        totalGrowth == null ? "" : el("span", { class: `num ${tone(totalGrowth)}` }, ` ${signedPct(totalGrowth, 1)}%`)) : "",
      stat(`${sectors.length} 類漲跌`, el("b", { class: "num" }, el("span", { class: "up" }, `${up} 漲`), " ", el("span", { class: "down" }, `${down} 跌`))),
      hasFlow ? "" : stat("成交比重增減", el("span", { class: "muted" }, "缺前一交易日資料")),
      drop && drop.share_change < 0 ? stat("比重下降最多", el("b", {}, drop.name), el("span", { class: "num down" }, ` ${signedPct(drop.share_change)}`)) : "",
    );

    let mode = readSort() === "change" || !hasFlow ? "change" : "flow";
    const open = new Set();
    const flowBtn = document.querySelector('#sectors .seg [data-sort="flow"]');
    flowBtn.disabled = !hasFlow;
    flowBtn.title = hasFlow ? "" : "缺前一交易日資料，暫時無法比較";
    buttons.forEach((b) => { if (b !== flowBtn) b.disabled = false; });

    function draw() {
      const m = MODES[mode];
      const other = MODES[mode === "flow" ? "change" : "flow"];
      const rows = sectors.slice().sort(m.sort).slice(0, TOP_SECTORS);
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.sort === mode)));

      const head = el("li", { class: "sector-row sector-head", "aria-hidden": "true" },
        el("span", {}, "#"), el("span", {}, "類股"),
        el("span", { class: "active" }, `${m.label}（${m.unit}）`),
        el("span", { class: "r" }, "成交金額（億）"), el("span", { class: "r" }, "成交比重"),
        el("span", { class: "r" }, other.label), el("span", {}));

      list.replaceChildren(head, ...rows.map((s, i) => {
        const id = `sector-detail-${i}`;
        const v = m.value(s);
        const ov = other.value(s);
        const g = growth(s.value, s.prev_value);
        const isOpen = open.has(s.name);
        const btn = el("button", {
          type: "button", class: "sector-row", "aria-expanded": String(isOpen), "aria-controls": id,
          "aria-label": `第 ${i + 1} 名 ${sectorLabel(s)}。查看漲幅前五檔`,
        },
          el("span", { class: "num rank-no" }, i + 1),
          el("span", { class: "sector-name" },
            el("b", {}, s.name),
            el("small", { class: "num" }, el("span", { class: "up" }, `${s.up} 漲`), " ", el("span", { class: "down" }, `${s.down} 跌`))),
          el("span", { class: "sector-hero" },
            sectorBar(v, m.scale),
            el("b", { class: `num ${tone(v)}` }, mode === "flow" ? signedPct(v) : signedPct(v) + "%",
              mode === "flow" ? el("small", {}, " 百分點") : null)),
          el("span", { class: "sector-sub" },
          el("span", { class: "r num cell-value" }, el("span", { class: "lbl" }, "成交 "), yi(s.value),
            g == null ? null : el("small", { class: tone(g) }, ` ${signedPct(g, 0)}%`)),
          el("span", { class: "r num cell-share" }, el("span", { class: "lbl" }, "比重 "), s.share == null ? "—" : `${s.share.toFixed(2)}%`),
          el("span", { class: `r num cell-other ${tone(ov)}` }, el("span", { class: "lbl" }, mode === "flow" ? "漲跌 " : "比重增減 "),
            mode === "flow" ? signedPct(ov) + "%" : signedPct(ov))),
          el("span", { class: "chev", "aria-hidden": "true" }),
        );
        const detail = el("div", { class: "sector-detail", id, hidden: !isOpen },
          el("div", { class: "detail-head" }, el("span", {}, `${s.name}・漲幅前五檔`), el("span", { class: "muted" }, `共 ${s.count} 檔`)),
          breadthNote(s),
          renderSectorTop(s));
        btn.addEventListener("click", () => {
          const now = btn.getAttribute("aria-expanded") !== "true";
          btn.setAttribute("aria-expanded", String(now));
          detail.hidden = !now;
          if (now) open.add(s.name); else open.delete(s.name);
        });
        return el("li", {}, btn, detail);
      }));
    }

    buttons.forEach((b) => {
      b.onclick = () => {
        if (b.disabled || b.dataset.sort === mode) return;
        mode = b.dataset.sort;
        saveSort(mode);
        draw();
      };
    });
    draw();
  }

  function loadSectors() {
    const list = $("sector-list");
    list.replaceChildren(el("li", { class: "empty" }, "資料載入中…"));
    loadJSON("data/sectors.json").then(renderSectors).catch((err) => {
      console.error(err);
      const retry = el("button", { type: "button", class: "retry" }, "重試");
      retry.addEventListener("click", loadSectors);
      list.replaceChildren(el("li", { class: "empty" }, "類股資料讀取失敗，可能是網路不穩。", el("br"), retry));
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
