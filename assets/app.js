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

  // ---------- 02 大盤分析 ----------
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

  // ---------- 03 新聞 ----------
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
      box.replaceChildren(el(box.tagName === "OL" ? "li" : "div", { class: "empty" }, msg));
    };
  }

  tickClock();
  setInterval(tickClock, 30 * 1000);
  loadJSON("data/chips.json").then(renderChips).catch(fail("chips-grid", "籌碼資料讀取失敗，請稍後重新整理。"));
  loadJSON("data/analysis.json").then(renderAnalysis).catch(fail("article", "大盤分析讀取失敗，請稍後重新整理。"));
  loadJSON("data/news.json").then(renderNews).catch(fail("news-list", "新聞讀取失敗，請稍後重新整理。"));
  loadJSON("data/media.json").then(renderMedia).catch(fail("yt-list", "節目資料讀取失敗，請稍後重新整理。"));
})();
