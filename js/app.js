(function () {
  const STORAGE_KEY = "rolldan_aksjer_custom_portfolio_v1";
  const WATCHLIST_KEY = "rolldan_aksjer_watchlist_v1";
  const GH_TOKEN_KEY = "rolldan_aksjer_gh_token";
  let appData = null;
  let watchlistSet = new Set();

  const els = {
    lastUpdated: document.getElementById("last-updated-badge"),
    refreshNowBtn: document.getElementById("refresh-now-btn"),
    localBanner: document.getElementById("local-override-banner"),
    watchlistTabCount: document.getElementById("watchlist-tab-count"),
    kpiPortfolioVal: document.getElementById("kpi-portfolio-val"),
    kpiTotalVal: document.getElementById("kpi-total-val"),
    kpiDayChange: document.getElementById("kpi-day-change"),
    kpiUnrealized: document.getElementById("kpi-unrealized"),
    kpiRule15: document.getElementById("kpi-rule-15"),
    kpiRule15Sub: document.getElementById("kpi-rule-15-sub"),
    kpiNewswebCount: document.getElementById("kpi-newsweb-count"),
    kpiNewswebSub: document.getElementById("kpi-newsweb-sub"),
    searchInput: document.getElementById("search-input"),
    brokerFilter: document.getElementById("broker-filter"),
    ratingFilter: document.getElementById("rating-filter"),
    ownershipFilter: document.getElementById("ownership-filter"),
    sortSelect: document.getElementById("sort-select"),
    stocksGrid: document.getElementById("stocks-grid"),
    resultsSummary: document.getElementById("results-summary"),
    wlSelectExisting: document.getElementById("wl-select-existing"),
    wlCustomTicker: document.getElementById("wl-custom-ticker"),
    wlCustomName: document.getElementById("wl-custom-name"),
    wlAddBtn: document.getElementById("wl-add-btn"),
    wlSearch: document.getElementById("wl-search"),
    wlSummary: document.getElementById("wl-summary"),
    watchlistGrid: document.getElementById("watchlist-grid"),
    resetWatchlistBtn: document.getElementById("reset-watchlist-btn"),
    seasSearch: document.getElementById("seas-search"),
    seasScope: document.getElementById("seas-scope"),
    seasMonthFilter: document.getElementById("seas-month-filter"),
    seasSort: document.getElementById("seas-sort"),
    seasSummary: document.getElementById("seas-summary"),
    seasonalityGrid: document.getElementById("seasonality-grid"),
    bmSearch: document.getElementById("bm-search"),
    bmRelevance: document.getElementById("bm-relevance"),
    bmCategory: document.getElementById("bm-category"),
    bmSummary: document.getElementById("bm-summary"),
    bmTbody: document.getElementById("bm-tbody"),
    editCashInput: document.getElementById("edit-cash-input"),
    exportJsonBtn: document.getElementById("export-json-btn"),
    resetLocalBtn: document.getElementById("reset-local-btn"),
    newTicker: document.getElementById("new-ticker"),
    newName: document.getElementById("new-name"),
    newSector: document.getElementById("new-sector"),
    newCurrency: document.getElementById("new-currency"),
    newShares: document.getElementById("new-shares"),
    newGav: document.getElementById("new-gav"),
    newPrice: document.getElementById("new-price"),
    addStockBtn: document.getElementById("add-stock-btn"),
    ghTokenInput: document.getElementById("gh-token-input"),
    saveToGithubBtn: document.getElementById("save-to-github-btn"),
    ghSyncStatus: document.getElementById("gh-sync-status"),
    bulkPasteInput: document.getElementById("bulk-paste-input"),
    bulkImportBtn: document.getElementById("bulk-import-btn"),
    editorTbody: document.getElementById("editor-tbody"),
    dailyValuesTbody: document.getElementById("daily-values-tbody"),
    rebalanceTbody: document.getElementById("rebalance-tbody"),
    sectorTbody: document.getElementById("sector-tbody"),
    modelGrid: document.getElementById("model-grid"),
    newsTbody: document.getElementById("news-tbody")
  };

  function formatNumber(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return "–";
    return Number(num).toLocaleString("nb-NO", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function ratingBadgeClass(rating) {
    const r = (rating || "").toUpperCase();
    if (r.includes("KJØP") || r.includes("ØK")) return "badge-buy";
    if (r.includes("SELG") || r.includes("REDUSER") || r.includes("TRIM") || r.includes("UNNGÅ")) return "badge-sell";
    return "badge-hold";
  }

  function getFxRate(currency) {
    const rates = (appData && appData.metadata && appData.metadata.fx_rates) || {
      NOK: 1.0,
      SEK: 0.9568,
      DKK: 1.437,
      EUR: 10.7414
    };
    return Number(rates[currency] || 1.0);
  }

  function loadWatchlist(defaultList) {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          watchlistSet = new Set(parsed.map((t) => String(t).toUpperCase()));
          return;
        }
      }
    } catch (e) {
      // Fallback til default
    }
    watchlistSet = new Set((defaultList || []).map((t) => String(t).toUpperCase()));
  }

  function saveWatchlist() {
    const arr = Array.from(watchlistSet);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(arr));
    if (appData) {
      appData.watchlist = arr;
    }
  }

  function isWatched(ticker) {
    return watchlistSet.has(String(ticker || "").toUpperCase());
  }

  function toggleWatchlist(ticker, customName) {
    const clean = String(ticker || "").trim().toUpperCase();
    if (!clean) return;
    if (watchlistSet.has(clean)) {
      watchlistSet.delete(clean);
    } else {
      watchlistSet.add(clean);
      ensureStockExists(clean, customName);
    }
    saveWatchlist();
    refreshAllViews(false);
  }

  function ensureStockExists(ticker, customName) {
    if (!appData) return;
    const clean = String(ticker || "").trim().toUpperCase();
    const existing = appData.stocks.find((s) => s.ticker.toUpperCase() === clean);
    if (existing) {
      if (customName && existing.name === existing.ticker) {
        existing.name = customName;
      }
      return existing;
    }
    const newStock = {
      ticker: clean,
      name: customName || clean,
      exchange: clean.endsWith(".OL") ? "OSE" : clean.endsWith(".ST") ? "SSE" : clean.endsWith(".CO") ? "CSE" : "NORDIC",
      currency: clean.endsWith(".OL") ? "NOK" : clean.endsWith(".ST") ? "SEK" : clean.endsWith(".CO") ? "DKK" : "EUR",
      sector: "Følg med på",
      in_portfolio: false,
      shares: 0,
      gav: 0,
      price: 0,
      value_nok: 0,
      weight_pct: 0,
      rule_status: "Følg med på",
      portfolio_action: "FØLG MED PÅ",
      portfolio_rationale: "Lagt til i «Følg med på»-listen. Kurs og sesongmønster oppdateres ved neste synkronisering.",
      recommendations: []
    };
    appData.stocks.push(newStock);
    saveLocalOverrides();
    return newStock;
  }

  function loadLocalOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveLocalOverrides() {
    if (!appData) return;
    const payload = {
      saved_at: new Date().toISOString(),
      cash_nok: Number(appData.metadata.cash_nok || 0),
      stocks: appData.stocks.map((s) => ({
        ticker: s.ticker,
        name: s.name,
        exchange: s.exchange,
        currency: s.currency,
        sector: s.sector,
        in_portfolio: Boolean(s.in_portfolio),
        shares: Number(s.shares || 0),
        gav: Number(s.gav || 0),
        custom_price: s._custom_price ? Number(s.price) : null,
        portfolio_action: s.portfolio_action,
        portfolio_rationale: s.portfolio_rationale
      }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    updateOverrideBanner();
  }

  function applyLocalOverrides(serverData) {
    const ov = loadLocalOverrides();
    if (!ov || !Array.isArray(ov.stocks)) return serverData;

    if (typeof ov.cash_nok === "number" && !isNaN(ov.cash_nok)) {
      serverData.metadata.cash_nok = ov.cash_nok;
    }

    const serverMap = new Map(serverData.stocks.map((s) => [s.ticker.toUpperCase(), s]));
    const mergedStocks = [];

    ov.stocks.forEach((custom) => {
      const key = (custom.ticker || "").toUpperCase();
      const srv = serverMap.get(key);
      if (srv) {
        srv.in_portfolio = Boolean(custom.in_portfolio);
        srv.shares = Number(custom.shares || 0);
        srv.gav = Number(custom.gav || 0);
        if (custom.sector) srv.sector = custom.sector;
        if (custom.name) srv.name = custom.name;
        if (custom.custom_price && custom.custom_price > 0) {
          srv.price = Number(custom.custom_price);
          srv._custom_price = true;
        }
        mergedStocks.push(srv);
        serverMap.delete(key);
      } else {
        mergedStocks.push({
          ticker: custom.ticker,
          name: custom.name || custom.ticker,
          exchange: custom.exchange || (custom.ticker.endsWith(".OL") ? "OSE" : "NORDIC"),
          currency: custom.currency || "NOK",
          sector: custom.sector || "Annet",
          in_portfolio: Boolean(custom.in_portfolio),
          shares: Number(custom.shares || 0),
          gav: Number(custom.gav || 0),
          price: Number(custom.custom_price || custom.gav || 0),
          _custom_price: true,
          value_nok: 0,
          weight_pct: 0,
          rule_status: "Innenfor (< 15 %)",
          portfolio_action: custom.in_portfolio ? "HOLD" : "KANDIDAT",
          portfolio_rationale: custom.portfolio_rationale || "Lagt til manuelt på nettsiden.",
          recommendations: []
        });
      }
    });

    serverMap.forEach((remaining) => mergedStocks.push(remaining));
    serverData.stocks = mergedStocks;
    return serverData;
  }

  function recalculatePortfolio() {
    if (!appData) return;
    let totalPortNok = 0;
    let totalPrevNok = 0;
    let totalCostNok = 0;

    appData.stocks.forEach((s) => {
      const shares = Number(s.shares || 0);
      const price = Number(s.price || 0);
      const prevClose = Number(s.prev_close || price);
      const gav = Number(s.gav || 0);
      const fx = getFxRate(s.currency || "NOK");

      (s.recommendations || []).forEach((rec) => {
        if (price > 0 && rec.target > 0) {
          rec.upside_pct = Number((((rec.target / price) - 1) * 100).toFixed(1));
        }
      });

      if (s.in_portfolio && shares > 0) {
        const valNok = shares * price * fx;
        const prevNok = shares * prevClose * fx;
        const costNok = gav > 0 ? shares * gav * fx : valNok;
        s.value_nok = Number(valNok.toFixed(2));
        s.day_change_nok = Number((valNok - prevNok).toFixed(2));
        s.cost_nok = Number(costNok.toFixed(2));
        s.unrealized_nok = Number((valNok - costNok).toFixed(2));
        s.unrealized_pct = costNok > 0 ? Number((((valNok / costNok) - 1) * 100).toFixed(2)) : 0;
        totalPortNok += valNok;
        totalPrevNok += prevNok;
        totalCostNok += costNok;
      } else {
        s.value_nok = 0;
        s.day_change_nok = 0;
        s.cost_nok = 0;
        s.unrealized_nok = 0;
        s.unrealized_pct = 0;
        s.weight_pct = 0;
      }
    });

    appData.stocks.forEach((s) => {
      if (s.in_portfolio && totalPortNok > 0) {
        const w = (s.value_nok / totalPortNok) * 100;
        s.weight_pct = Number(w.toFixed(2));
        const rsLower = (s.rule_status || "").toLowerCase();
        if (w > 15.0) {
          s.rule_status = `BRUDD (> 15 %: ${formatNumber(w, 1)} %)`;
        } else if (w >= 12.0) {
          s.rule_status = "Nær taket (12–15 %)";
        } else if (!rsLower.includes("kvalitetskrav") && !rsLower.includes("tvangsinnløsning")) {
          s.rule_status = "Innenfor (< 15 %)";
        }
      }
    });

    const cashNok = Number(appData.metadata.cash_nok || 0);
    const dayChangeNok = totalPortNok - totalPrevNok;
    const dayChangePct = totalPrevNok > 0 ? ((totalPortNok / totalPrevNok) - 1) * 100 : 0;
    const unrealizedNok = totalPortNok - totalCostNok;
    const unrealizedPct = totalCostNok > 0 ? (unrealizedNok / totalCostNok) * 100 : 0;

    appData.metadata.portfolio_value_nok = Number(totalPortNok.toFixed(2));
    appData.metadata.total_value_nok = Number((totalPortNok + cashNok).toFixed(2));
    appData.metadata.day_change_nok = Number(dayChangeNok.toFixed(2));
    appData.metadata.day_change_pct = Number(dayChangePct.toFixed(2));
    appData.metadata.unrealized_pnl_nok = Number(unrealizedNok.toFixed(2));
    appData.metadata.unrealized_pnl_pct = Number(unrealizedPct.toFixed(2));
  }

  function updateOverrideBanner() {
    const ov = loadLocalOverrides();
    if (ov && ov.saved_at) {
      els.localBanner.style.display = "block";
      els.localBanner.innerHTML = `Viser din manuelt oppdaterte aksjeliste (lagret i nettleseren ${ov.saved_at.slice(0, 16).replace("T", " ")}). Kurser, sesongmønster, kursmål og børsmeldinger hentes løpende fra serveren.`;
    } else {
      els.localBanner.style.display = "none";
    }
  }

  function renderKpis() {
    if (!appData) return;
    const m = appData.metadata || {};
    const cdlrStock = appData.stocks.find((s) => s.ticker === "CDLR.OL" && s.in_portfolio);
    const cdlrVal = cdlrStock ? Number(cdlrStock.value_nok || 0) : 0;
    const mobileVal = Number(m.portfolio_value_nok || 0) - cdlrVal;

    if (cdlrVal > 0) {
      els.kpiPortfolioVal.textContent = `${formatNumber(mobileVal, 0)} NOK`;
      els.kpiTotalVal.textContent = `+ Cadeler-oppgjør (${formatNumber(cdlrVal, 0)} NOK) = ${formatNumber(m.portfolio_value_nok, 0)} NOK`;
    } else {
      els.kpiPortfolioVal.textContent = `${formatNumber(m.portfolio_value_nok, 0)} NOK`;
      els.kpiTotalVal.textContent = `Inkl. kontanter (${formatNumber(m.cash_nok, 0)} NOK): ${formatNumber(m.total_value_nok, 0)} NOK`;
    }

    const dNok = Number(m.day_change_nok || 0);
    const dPct = Number(m.day_change_pct || 0);
    const dSign = dNok >= 0 ? "+" : "";
    els.kpiDayChange.textContent = `${dSign}${formatNumber(dNok, 0)} NOK (${dSign}${formatNumber(dPct, 2)} %)`;
    els.kpiDayChange.className = `kpi-value ${dNok >= 0 ? "upside-pos" : "upside-neg"}`;

    const uNok = Number(m.unrealized_pnl_nok || 0);
    const uPct = Number(m.unrealized_pnl_pct || 0);
    const uSign = uNok >= 0 ? "+" : "";
    els.kpiUnrealized.textContent = `Urealisert totalt: ${uSign}${formatNumber(uNok, 0)} NOK (${uSign}${formatNumber(uPct, 1)} %)`;

    const breaches = appData.stocks.filter((s) => s.in_portfolio && s.weight_pct > 15.0);
    const nearCap = appData.stocks.filter((s) => s.in_portfolio && s.weight_pct >= 12.0 && s.weight_pct <= 15.0);
    if (breaches.length > 0) {
      els.kpiRule15.style.color = "#f87171";
      els.kpiRule15.textContent = `${breaches.length} brudd (${breaches.map((b) => `${b.ticker.split(".")[0]} ${formatNumber(b.weight_pct, 1)} %`).join(", ")})`;
    } else {
      els.kpiRule15.style.color = "#34d399";
      els.kpiRule15.textContent = "0 brudd (Alle < 15 %)";
    }
    els.kpiRule15Sub.textContent =
      nearCap.length > 0
        ? `${nearCap.length} nær taket: ${nearCap.map((n) => `${n.ticker.split(".")[0]} (${formatNumber(n.weight_pct, 1)} %)`).join(", ")}`
        : "Ingen nær 15 %-taket";

    const bm = appData.borsmeldinger || [];
    els.watchlistTabCount.textContent = watchlistSet.size;
    els.kpiNewswebCount.textContent = `${watchlistSet.size} fulgte aksjer`;
    els.kpiNewswebSub.textContent = `${bm.length} børsmeldinger fra Oslo Børs`;
  }

  function renderSeasonalityMiniBox(stock) {
    const seas = stock.seasonality;
    if (!seas || !Array.isArray(seas.months)) return "";
    const cells = seas.months
      .map((m) => {
        const avg = Number(m.avg_pct || 0);
        const cls = m.count > 0 ? (avg > 0.3 ? "pos" : avg < -0.3 ? "neg" : "") : "";
        const sign = avg > 0 ? "+" : "";
        return `
          <div class="season-cell ${cls}" title="${m.name}: snitt ${sign}${formatNumber(avg, 1)} %, positiv i ${m.win_rate_pct} % av årene (${m.count} år)">
            <span>${m.name}</span>
            <strong class="${avg >= 0 ? "upside-pos" : "upside-neg"}">${m.count > 0 ? `${sign}${formatNumber(avg, 1)}%` : "–"}</strong>
          </div>
        `;
      })
      .join("");

    const bNames = (seas.best_months || []).map((b) => `${b.name} (${b.avg_pct >= 0 ? "+" : ""}${formatNumber(b.avg_pct, 1)} %)`).join(", ");
    const wNames = (seas.weakest_months || []).map((w) => `${w.name} (${w.avg_pct >= 0 ? "+" : ""}${formatNumber(w.avg_pct, 1)} %)`).join(", ");

    return `
      <div class="season-box">
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.35rem;">
          <span><strong>Historisk sesong (${seas.years_analyzed} år):</strong> Sterkest: <span class="upside-pos">${bNames}</span></span>
          <span>Svakest: <span class="upside-neg">${wNames}</span></span>
        </div>
        <div class="season-grid">${cells}</div>
      </div>
    `;
  }

  function computeStats(stock, brokerFilter, ratingFilter) {
    const recs = (stock.recommendations || []).filter((r) => {
      if (brokerFilter !== "ALL" && r.broker !== brokerFilter) return false;
      if (ratingFilter !== "ALL" && r.rating !== ratingFilter) return false;
      return true;
    });
    const allRecs = stock.recommendations || [];
    const avgUpside =
      recs.length > 0
        ? recs.reduce((acc, r) => acc + (r.upside_pct || 0), 0) / recs.length
        : -999;
    const maxUpside =
      recs.length > 0
        ? Math.max(...recs.map((r) => r.upside_pct || -999))
        : -999;
    const buyCount = allRecs.filter((r) => r.rating === "KJØP").length;
    return { filteredRecs: recs, avgUpside, maxUpside, buyCount, totalCount: allRecs.length };
  }

  function buildStockCardHtml(stock, stats, includeSeasonality = false) {
    const avgTarget =
      stats.filteredRecs.length > 0
        ? stats.filteredRecs.reduce((acc, r) => acc + r.target, 0) / stats.filteredRecs.length
        : 0;
    const upsideCls = stats.avgUpside >= 0 ? "upside-pos" : "upside-neg";
    const upsidePrefix = stats.avgUpside >= 0 ? "+" : "";
    const isBreach = (stock.rule_status || "").toUpperCase().includes("BRUDD");
    const dayPct = Number(stock.day_change_pct || 0);
    const daySign = dayPct >= 0 ? "+" : "";
    const dayCls = dayPct >= 0 ? "upside-pos" : "upside-neg";
    const watched = isWatched(stock.ticker);

    const recsHtml =
      stats.filteredRecs.length > 0
        ? stats.filteredRecs
            .map((r) => {
              const uCls = r.upside_pct >= 0 ? "upside-pos" : "upside-neg";
              const uPref = r.upside_pct >= 0 ? "+" : "";
              return `
                <div class="rec-row">
                  <strong>${r.broker}</strong>
                  <span class="badge ${ratingBadgeClass(r.rating)}">${r.rating}</span>
                  <span>${formatNumber(r.target, 2)} ${stock.currency}</span>
                  <span class="${uCls}">${uPref}${formatNumber(r.upside_pct, 1)} %</span>
                  <div class="rec-source">${r.date} &bull; ${r.source}</div>
                </div>
              `;
            })
            .join("")
        : `<div class="rec-source" style="padding: 0.4rem;">Ingen registrerte meglerkursmål i tabellen ennå.</div>`;

    return `
      <article class="stock-card">
        <div class="stock-header">
          <div>
            <div class="stock-title">${stock.name} <span style="color: var(--text-muted); font-weight: 500;">(${stock.ticker})</span></div>
            <div class="stock-meta">${stock.exchange} &bull; ${stock.sector} &bull; ${
      stock.in_portfolio
        ? `<strong>${formatNumber(stock.value_nok, 0)} NOK</strong> (${formatNumber(stock.weight_pct, 2)} %)`
        : "Kandidat / Overvåkes"
    }</div>
          </div>
          <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
            <button class="btn-watch ${watched ? "active" : ""}" data-watch-ticker="${stock.ticker}" title="Legg til eller fjern fra Følg med på">
              ${watched ? "★ Følger" : "☆ Følg med på"}
            </button>
            <span class="badge ${ratingBadgeClass(stock.portfolio_action)}">${stock.portfolio_action}</span>
          </div>
        </div>

        <div class="stock-metrics">
          <div class="metric-item">
            <span>Siste kurs</span>
            <strong>${stock.price > 0 ? `${formatNumber(stock.price, 2)} ${stock.currency}` : "–"}</strong>
          </div>
          <div class="metric-item">
            <span>I dag</span>
            <strong class="${dayCls}">${daySign}${formatNumber(dayPct, 2)} %</strong>
          </div>
          <div class="metric-item">
            <span>Snitt kursmål (${stats.filteredRecs.length})</span>
            <strong>${avgTarget > 0 ? `${formatNumber(avgTarget, 2)} ${stock.currency}` : "–"}</strong>
          </div>
          <div class="metric-item">
            <span>Snitt oppside</span>
            <strong class="${upsideCls}">${stats.avgUpside > -900 ? `${upsidePrefix}${formatNumber(stats.avgUpside, 1)} %` : "–"}</strong>
          </div>
        </div>

        <div class="portfolio-rule-box ${isBreach ? "breach" : ""}">
          <strong>Status (${stock.rule_status}):</strong> ${stock.portfolio_rationale}
        </div>

        ${includeSeasonality ? renderSeasonalityMiniBox(stock) : ""}

        <div class="rec-list">
          ${recsHtml}
        </div>
      </article>
    `;
  }

  function bindWatchButtons(container) {
    container.querySelectorAll("[data-watch-ticker]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const t = e.currentTarget.dataset.watchTicker;
        toggleWatchlist(t);
      });
    });
  }

  function renderStocks() {
    if (!appData) return;
    const q = (els.searchInput.value || "").trim().toLowerCase();
    const broker = els.brokerFilter.value;
    const rating = els.ratingFilter.value;
    const ownership = els.ownershipFilter.value;
    const sortBy = els.sortSelect.value;

    let list = appData.stocks
      .map((s) => {
        const stats = computeStats(s, broker, rating);
        return { stock: s, stats };
      })
      .filter(({ stock, stats }) => {
        if (ownership === "PORTFOLIO" && !stock.in_portfolio) return false;
        if (ownership === "WATCHLIST" && !isWatched(stock.ticker)) return false;
        if (ownership === "CANDIDATES" && stock.in_portfolio) return false;
        if ((broker !== "ALL" || rating !== "ALL") && stats.filteredRecs.length === 0) {
          return false;
        }
        if (q) {
          const hay = `${stock.name} ${stock.ticker} ${stock.sector} ${stock.portfolio_action}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    list.sort((a, b) => {
      if (sortBy === "weight_desc") return (b.stock.weight_pct || 0) - (a.stock.weight_pct || 0);
      if (sortBy === "upside_desc") return b.stats.avgUpside - a.stats.avgUpside;
      if (sortBy === "max_upside_desc") return b.stats.maxUpside - a.stats.maxUpside;
      if (sortBy === "buy_count_desc") return b.stats.buyCount - a.stats.buyCount;
      if (sortBy === "name_asc") return a.stock.name.localeCompare(b.stock.name, "nb");
      return 0;
    });

    const totalRecsShown = list.reduce((sum, item) => sum + item.stats.filteredRecs.length, 0);
    els.resultsSummary.textContent = `Viser ${list.length} aksjer og ${totalRecsShown} megleranbefalinger. Klikk «☆ Følg med på» på en aksje for å legge den i din egen overvåkningsliste.`;

    els.stocksGrid.innerHTML = list.map(({ stock, stats }) => buildStockCardHtml(stock, stats, false)).join("");
    bindWatchButtons(els.stocksGrid);
  }

  function renderWatchlist() {
    if (!appData) return;

    // Populer nedtrekksmeny med aksjer som ikke allerede følges
    const unwatched = [...appData.stocks]
      .filter((s) => !isWatched(s.ticker))
      .sort((a, b) => a.name.localeCompare(b.name, "nb"));
    els.wlSelectExisting.innerHTML =
      `<option value="">-- Velg blant ${unwatched.length} aksjer i databasen --</option>` +
      unwatched.map((s) => `<option value="${s.ticker}">${s.name} (${s.ticker})</option>`).join("");

    const q = (els.wlSearch.value || "").trim().toLowerCase();
    const watchedList = appData.stocks
      .filter((s) => isWatched(s.ticker))
      .map((s) => ({ stock: s, stats: computeStats(s, "ALL", "ALL") }))
      .filter(({ stock }) => {
        if (!q) return true;
        return `${stock.name} ${stock.ticker} ${stock.sector}`.toLowerCase().includes(q);
      })
      .sort((a, b) => b.stats.avgUpside - a.stats.avgUpside);

    els.wlSummary.textContent = `Du følger med på ${watchlistSet.size} aksjer (sorteret etter høyeste snitt-oppside til meglerhusenes kursmål).`;

    if (watchedList.length === 0) {
      els.watchlistGrid.innerHTML = `<div class="stock-card">Ingen aksjer i «Følg med på» matcher søket. Klikk på «☆ Følg med på» på en aksje eller legg til ovenfor.</div>`;
      return;
    }

    els.watchlistGrid.innerHTML = watchedList.map(({ stock, stats }) => buildStockCardHtml(stock, stats, true)).join("");
    bindWatchButtons(els.watchlistGrid);
  }

  function getMonthAvg(stock, monthNum) {
    if (!stock.seasonality || !Array.isArray(stock.seasonality.months)) return -999;
    const m = stock.seasonality.months.find((x) => Number(x.month) === Number(monthNum));
    return m && m.count > 0 ? Number(m.avg_pct) : -999;
  }

  function renderSeasonality() {
    if (!appData) return;
    const q = (els.seasSearch.value || "").trim().toLowerCase();
    const scope = els.seasScope.value;
    const focusMonth = els.seasMonthFilter.value;
    const sortBy = els.seasSort.value;

    let list = appData.stocks.filter((s) => {
      if (!s.seasonality || !Array.isArray(s.seasonality.months)) return false;
      if (scope === "PORTFOLIO" && !s.in_portfolio) return false;
      if (scope === "WATCHLIST" && !isWatched(s.ticker)) return false;
      if (scope === "CANDIDATES" && s.in_portfolio) return false;
      if (focusMonth !== "ALL") {
        const mAvg = getMonthAvg(s, Number(focusMonth));
        if (mAvg <= 0) return false;
      }
      if (q) {
        const hay = `${s.name} ${s.ticker} ${s.sector} ${s.seasonality.summary_no} ${s.seasonality.best_3m_window}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const activeFocusMonth = focusMonth !== "ALL" ? Number(focusMonth) : 12;

    list.sort((a, b) => {
      if (sortBy === "focus_month_desc") return getMonthAvg(b, activeFocusMonth) - getMonthAvg(a, activeFocusMonth);
      if (sortBy === "nov_desc") return getMonthAvg(b, 11) - getMonthAvg(a, 11);
      if (sortBy === "dec_desc") return getMonthAvg(b, 12) - getMonthAvg(a, 12);
      if (sortBy === "jan_desc") return getMonthAvg(b, 1) - getMonthAvg(a, 1);
      if (sortBy === "weight_desc") return (b.weight_pct || 0) - (a.weight_pct || 0);
      if (sortBy === "name_asc") return a.name.localeCompare(b.name, "nb");
      return 0;
    });

    els.seasSummary.textContent = `Viser historisk sesongmønster for ${list.length} aksjer.`;

    els.seasonalityGrid.innerHTML = list
      .map((s) => {
        const seas = s.seasonality;
        const watched = isWatched(s.ticker);
        const cells = seas.months
          .map((m) => {
            const avg = Number(m.avg_pct || 0);
            const isHighlighted = focusMonth !== "ALL" && Number(focusMonth) === Number(m.month);
            const cls = m.count > 0 ? (avg > 0.3 ? "pos" : avg < -0.3 ? "neg" : "") : "";
            const sign = avg > 0 ? "+" : "";
            return `
              <div class="season-cell ${cls}" style="${isHighlighted ? "outline: 2px solid var(--accent);" : ""}">
                <span>${m.name}</span>
                <strong class="${avg >= 0 ? "upside-pos" : "upside-neg"}">${m.count > 0 ? `${sign}${formatNumber(avg, 1)}%` : "–"}</strong>
                <span style="font-size: 0.62rem;">${m.count > 0 ? `${m.win_rate_pct}% pos` : ""}</span>
              </div>
            `;
          })
          .join("");

        return `
          <article class="stock-card">
            <div class="stock-header">
              <div>
                <div class="stock-title">${s.name} <span style="color: var(--text-muted); font-weight: 500;">(${s.ticker})</span></div>
                <div class="stock-meta">${s.exchange} &bull; ${s.sector} &bull; ${seas.years_analyzed} års historikk</div>
              </div>
              <div style="display: flex; gap: 0.4rem; align-items: center;">
                <button class="btn-watch ${watched ? "active" : ""}" data-watch-ticker="${s.ticker}">
                  ${watched ? "★ Følger" : "☆ Følg med på"}
                </button>
              </div>
            </div>

            <div class="stock-metrics" style="grid-template-columns: repeat(3, 1fr);">
              <div class="metric-item">
                <span>Beste 3-mnd periode</span>
                <strong class="upside-pos">${seas.best_3m_window || "–"}</strong>
              </div>
              <div class="metric-item">
                <span>Svakeste 3-mnd periode</span>
                <strong class="upside-neg">${seas.weakest_3m_window || "–"}</strong>
              </div>
              <div class="metric-item">
                <span>Siste kurs</span>
                <strong>${formatNumber(s.price, 2)} ${s.currency}</strong>
              </div>
            </div>

            <div class="season-grid">${cells}</div>

            <div class="portfolio-rule-box">
              ${seas.summary_no}
            </div>
          </article>
        `;
      })
      .join("");

    bindWatchButtons(els.seasonalityGrid);
  }

  function renderBorsmeldinger() {
    if (!appData) return;
    const allBm = appData.borsmeldinger || [];
    const q = (els.bmSearch.value || "").trim().toLowerCase();
    const relFilter = els.bmRelevance.value;
    const catFilter = els.bmCategory.value;

    const portIssuers = new Set(
      appData.stocks.filter((s) => s.in_portfolio).map((s) => s.ticker.split(".")[0].toUpperCase())
    );
    const watchIssuers = new Set(
      Array.from(watchlistSet).map((t) => t.split(".")[0].toUpperCase())
    );
    const candIssuers = new Set(
      appData.stocks.filter((s) => !s.in_portfolio).map((s) => s.ticker.split(".")[0].toUpperCase())
    );

    const filtered = allBm.filter((m) => {
      const iss = (m.ticker || "").toUpperCase();
      const isMine = portIssuers.has(iss);
      const isWatch = watchIssuers.has(iss);
      const isCand = !isMine && (candIssuers.has(iss) || m.is_candidate);

      if (relFilter === "MINE_AKSJER" && !isMine) return false;
      if (relFilter === "WATCHLIST" && !isWatch) return false;
      if (relFilter === "MINE_OG_KANDIDATER" && !isMine && !isCand && !isWatch) return false;
      if (relFilter === "KANDIDATER" && !isCand) return false;
      if (relFilter === "OSLO_BORS_ELLERS" && (isMine || isCand)) return false;

      const catUpper = (m.category || "").toUpperCase();
      if (catFilter === "INNSIDE" && !catUpper.includes("MELDEPLIKTIG") && !catUpper.includes("INNSIDE")) return false;
      if (catFilter === "RAPPORT" && !catUpper.includes("RAPPORT") && !catUpper.includes("ÅRSRAPPORT")) return false;
      if (catFilter === "FLAGGING" && !catUpper.includes("FLAGGING") && !catUpper.includes("KAPITAL")) return false;
      if (
        catFilter === "ANNEN" &&
        (catUpper.includes("MELDEPLIKTIG") || catUpper.includes("RAPPORT") || catUpper.includes("FLAGGING"))
      ) {
        return false;
      }

      if (q) {
        const hay = `${m.ticker} ${m.issuer_name} ${m.title} ${m.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    els.bmSummary.textContent = `Viser ${filtered.length} av ${allBm.length} børsmeldinger fra Oslo Børs NewsWeb.`;

    if (filtered.length === 0) {
      els.bmTbody.innerHTML = `<tr><td colspan="5" style="color: var(--text-muted);">Ingen børsmeldinger matcher filteret.</td></tr>`;
      return;
    }

    els.bmTbody.innerHTML = filtered
      .map((m) => {
        const iss = (m.ticker || "").toUpperCase();
        const isMine = portIssuers.has(iss);
        const isWatch = watchIssuers.has(iss);
        const isCand = !isMine && (candIssuers.has(iss) || m.is_candidate);
        let statusBadge = `<span class="badge badge-hold">Oslo Børs</span>`;
        if (isMine) {
          statusBadge = `<span class="badge badge-buy">Min portefølje</span>`;
        } else if (isWatch) {
          statusBadge = `<span class="badge badge-portfolio">★ Følg med på</span>`;
        } else if (isCand) {
          statusBadge = `<span class="badge badge-portfolio">Kandidat</span>`;
        }

        return `
          <tr>
            <td style="white-space: nowrap;">${m.published || "–"}</td>
            <td>${statusBadge}</td>
            <td><strong>${m.ticker}</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">${m.issuer_name || ""}</span></td>
            <td><span class="pill">${m.category || "Børsmelding"}</span></td>
            <td><a href="${m.url}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; font-weight: 500;">${m.title}</a></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderEditor() {
    if (!appData) return;
    els.editCashInput.value = Number(appData.metadata.cash_nok || 0);

    const sorted = [...appData.stocks].sort((a, b) => {
      if (a.in_portfolio !== b.in_portfolio) return a.in_portfolio ? -1 : 1;
      return (b.weight_pct || 0) - (a.weight_pct || 0);
    });

    els.editorTbody.innerHTML = sorted
      .map((s) => {
        const uNok = Number(s.unrealized_nok || 0);
        const uPct = Number(s.unrealized_pct || 0);
        const uSign = uNok >= 0 ? "+" : "";
        const uCls = uNok >= 0 ? "upside-pos" : "upside-neg";
        const watched = isWatched(s.ticker);

        return `
          <tr data-ticker="${s.ticker}">
            <td>
              <input type="checkbox" class="ed-in-port" data-ticker="${s.ticker}" ${s.in_portfolio ? "checked" : ""} />
            </td>
            <td>
              <button class="btn-watch ${watched ? "active" : ""}" data-watch-ticker="${s.ticker}">
                ${watched ? "★ Følger" : "☆ Følg"}
              </button>
            </td>
            <td>
              <strong>${s.name}</strong> (<code>${s.ticker}</code>)
              <div style="font-size: 0.75rem; color: var(--text-muted);">${s.exchange} &bull; ${s.currency}</div>
            </td>
            <td>
              <input type="text" class="inline-input ed-sector" data-ticker="${s.ticker}" value="${s.sector || ""}" style="width: 130px;" />
            </td>
            <td>
              <input type="number" step="1" class="inline-input ed-shares" data-ticker="${s.ticker}" value="${Number(s.shares || 0)}" />
            </td>
            <td>
              <input type="number" step="0.01" class="inline-input ed-gav" data-ticker="${s.ticker}" value="${Number(s.gav || 0)}" />
            </td>
            <td>
              <input type="number" step="0.01" class="inline-input ed-price" data-ticker="${s.ticker}" value="${Number(s.price || 0)}" />
            </td>
            <td><strong>${formatNumber(s.value_nok, 0)} NOK</strong></td>
            <td class="${s.in_portfolio ? uCls : ""}">${
          s.in_portfolio ? `${uSign}${formatNumber(uNok, 0)} NOK (${uSign}${formatNumber(uPct, 1)} %)` : "–"
        }</td>
            <td><strong>${s.in_portfolio ? `${formatNumber(s.weight_pct, 2)} %` : "0,00 %"}</strong></td>
            <td>
              <button class="btn btn-danger ed-remove-btn" data-ticker="${s.ticker}" style="padding: 0.25rem 0.55rem; font-size: 0.76rem;">Fjern</button>
            </td>
          </tr>
        `;
      })
      .join("");

    bindWatchButtons(els.editorTbody);

    document.querySelectorAll(".ed-in-port, .ed-sector, .ed-shares, .ed-gav, .ed-price").forEach((input) => {
      input.addEventListener("change", (e) => {
        const ticker = e.target.dataset.ticker;
        const stock = appData.stocks.find((st) => st.ticker === ticker);
        if (!stock) return;
        const row = e.target.closest("tr");
        stock.in_portfolio = row.querySelector(".ed-in-port").checked;
        stock.sector = row.querySelector(".ed-sector").value.trim() || stock.sector;
        stock.shares = Number(row.querySelector(".ed-shares").value || 0);
        stock.gav = Number(row.querySelector(".ed-gav").value || 0);
        const newPrice = Number(row.querySelector(".ed-price").value || 0);
        if (newPrice !== stock.price) {
          stock.price = newPrice;
          stock._custom_price = true;
        }
        if (stock.shares > 0 && !e.target.classList.contains("ed-in-port")) {
          stock.in_portfolio = true;
        }
        refreshAllViews(true);
      });
    });

    document.querySelectorAll(".ed-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const ticker = e.target.dataset.ticker;
        const stock = appData.stocks.find((st) => st.ticker === ticker);
        if (!stock) return;
        if (stock.recommendations && stock.recommendations.length > 0) {
          stock.in_portfolio = false;
          stock.shares = 0;
          stock.portfolio_action = "KANDIDAT";
        } else {
          appData.stocks = appData.stocks.filter((st) => st.ticker !== ticker);
        }
        refreshAllViews(true);
      });
    });
  }

  function renderRebalanceAndSectors() {
    if (!appData) return;

    const dv = appData.daily_values || [];
    els.dailyValuesTbody.innerHTML = dv
      .map((d) => {
        const dNok = Number(d.day_change_nok || 0);
        const dPct = Number(d.day_change_pct || 0);
        const dSign = dNok >= 0 ? "+" : "";
        const dCls = dNok >= 0 ? "upside-pos" : "upside-neg";
        const mobVal = d.mobile_visible_value_nok || (d.portfolio_value_nok - 25704.8);
        return `
          <tr>
            <td><strong>${d.date}</strong></td>
            <td>${d.updated_at || "Sluttkurs"}</td>
            <td><strong>${formatNumber(mobVal, 2)} NOK</strong></td>
            <td>${formatNumber(d.portfolio_value_nok, 2)} NOK</td>
            <td class="${dCls}">${dSign}${formatNumber(dNok, 2)} NOK (${dSign}${formatNumber(dPct, 2)} %)</td>
            <td class="${d.unrealized_pnl_nok >= 0 ? "upside-pos" : "upside-neg"}">${formatNumber(d.unrealized_pnl_nok, 2)} NOK</td>
          </tr>
        `;
      })
      .join("");

    els.rebalanceTbody.innerHTML = (appData.rebalancing_plan || [])
      .map((item) => {
        const sharesStr =
          item.shares_delta > 0
            ? `+${item.shares_delta} (ny: ${item.shares_after})`
            : `${item.shares_delta} (behold: ${item.shares_after})`;
        const amountStr =
          item.amount_nok > 0
            ? `+${formatNumber(item.amount_nok, 0)} NOK`
            : `${formatNumber(item.amount_nok, 0)} NOK`;
        return `
          <tr>
            <td><strong>#${item.step}</strong></td>
            <td><span class="badge ${ratingBadgeClass(item.action)}">${item.action}</span></td>
            <td><strong>${item.name}</strong> (<code>${item.ticker}</code>)</td>
            <td>${sharesStr}</td>
            <td>${formatNumber(item.price, 2)} ${item.currency}</td>
            <td class="${item.amount_nok >= 0 ? "upside-pos" : ""}">${amountStr}</td>
            <td>${formatNumber(item.weight_before_pct, 2)} % &rarr; <strong>${formatNumber(item.weight_after_pct, 2)} %</strong></td>
            <td>${item.rationale}</td>
          </tr>
        `;
      })
      .join("");

    els.sectorTbody.innerHTML = (appData.sectors || [])
      .map((s) => {
        const isBreach = s.weight_pct > 30;
        return `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${formatNumber(s.value_nok, 2)} NOK</td>
            <td class="${isBreach ? "upside-neg" : ""}">${formatNumber(s.weight_pct, 2)} %</td>
            <td class="upside-pos"><strong>${formatNumber(s.post_rebalance_pct, 2)} %</strong></td>
            <td><span class="badge ${isBreach ? "badge-sell" : "badge-buy"}">${s.status}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderModelsAndNews() {
    if (!appData) return;

    els.modelGrid.innerHTML = (appData.model_portfolios || [])
      .map((mp) => {
        const pills = mp.tickers.map((t) => `<span class="pill">${t}</span>`).join("");
        return `
          <div class="stock-card">
            <div class="stock-title">${mp.broker} — ${mp.name}</div>
            <div class="stock-meta">Publisert: ${mp.published} &bull; Inn: ${mp.changes_in.join(", ")} &bull; Ut: ${mp.changes_out.join(", ")}</div>
            <div class="pill-list">${pills}</div>
          </div>
        `;
      })
      .join("");

    const news = appData.news_feed || [];
    if (news.length === 0) {
      els.newsTbody.innerHTML = `<tr><td colspan="4" style="color: var(--text-muted);">Ingen nye RSS-elementer registrert ennå.</td></tr>`;
    } else {
      els.newsTbody.innerHTML = news
        .map(
          (n) => `
          <tr>
            <td>${n.published || "–"}</td>
            <td><strong>${n.broker || n.source || "Finansnyhet"}</strong></td>
            <td><a href="${n.link || "#"}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none;">${n.title}</a></td>
            <td>${n.detected_ticker ? `<span class="pill">${n.detected_ticker}</span>` : ""} ${
            n.detected_rating ? `<span class="badge ${ratingBadgeClass(n.detected_rating)}">${n.detected_rating}</span>` : ""
          } ${n.detected_target ? `Kursmål: ${n.detected_target}` : ""}</td>
          </tr>
        `
        )
        .join("");
    }
  }

  function refreshAllViews(persist = false) {
    recalculatePortfolio();
    if (persist) {
      saveLocalOverrides();
    } else {
      updateOverrideBanner();
    }
    renderKpis();
    renderStocks();
    renderWatchlist();
    renderSeasonality();
    renderBorsmeldinger();
    renderEditor();
    renderRebalanceAndSectors();
    renderModelsAndNews();
  }

  function setupWatchlistActions() {
    els.wlAddBtn.addEventListener("click", () => {
      const selected = els.wlSelectExisting.value;
      let custom = (els.wlCustomTicker.value || "").trim().toUpperCase();
      const customName = (els.wlCustomName.value || "").trim();

      let targetTicker = custom || selected;
      if (!targetTicker) return;
      if (!targetTicker.includes(".")) {
        targetTicker += ".OL";
      }

      watchlistSet.add(targetTicker);
      ensureStockExists(targetTicker, customName);
      saveWatchlist();

      els.wlSelectExisting.value = "";
      els.wlCustomTicker.value = "";
      els.wlCustomName.value = "";
      refreshAllViews(false);
    });

    els.resetWatchlistBtn.addEventListener("click", () => {
      localStorage.removeItem(WATCHLIST_KEY);
      loadWatchlist((appData && appData.watchlist) || []);
      refreshAllViews(false);
    });
  }

  function setupEditorActions() {
    els.editCashInput.addEventListener("change", () => {
      appData.metadata.cash_nok = Number(els.editCashInput.value || 0);
      refreshAllViews(true);
    });

    els.addStockBtn.addEventListener("click", () => {
      let ticker = (els.newTicker.value || "").trim().toUpperCase();
      if (!ticker) return;
      const cur = els.newCurrency.value || "NOK";
      if (!ticker.includes(".") && cur === "NOK") ticker += ".OL";

      const name = (els.newName.value || "").trim() || ticker;
      const sector = (els.newSector.value || "").trim() || "Annet";
      const shares = Number(els.newShares.value || 0);
      const gav = Number(els.newGav.value || 0);
      const price = Number(els.newPrice.value || gav || 0);

      let existing = appData.stocks.find((s) => s.ticker.toUpperCase() === ticker);
      if (existing) {
        existing.name = name || existing.name;
        existing.sector = sector || existing.sector;
        existing.currency = cur;
        existing.shares = shares;
        existing.gav = gav || existing.gav;
        if (price > 0) {
          existing.price = price;
          existing._custom_price = true;
        }
        existing.in_portfolio = shares > 0;
        existing.portfolio_action = shares > 0 ? "HOLD" : "KANDIDAT";
      } else {
        appData.stocks.push({
          ticker,
          name,
          exchange: cur === "NOK" ? "OSE" : cur === "SEK" ? "SSE" : cur === "DKK" ? "CSE" : "HEX",
          currency: cur,
          sector,
          in_portfolio: shares > 0,
          shares,
          gav,
          price,
          _custom_price: price > 0,
          value_nok: 0,
          weight_pct: 0,
          rule_status: "Innenfor (< 15 %)",
          portfolio_action: shares > 0 ? "HOLD" : "KANDIDAT",
          portfolio_rationale: "Lagt til manuelt i aksjelisten.",
          recommendations: []
        });
      }

      els.newTicker.value = "";
      els.newName.value = "";
      els.newSector.value = "";
      els.newShares.value = "";
      els.newGav.value = "";
      els.newPrice.value = "";
      refreshAllViews(true);
    });

    els.bulkImportBtn.addEventListener("click", () => {
      const lines = (els.bulkPasteInput.value || "").split(/\r?\n/);
      let count = 0;
      lines.forEach((line) => {
        const parts = line.trim().split(/[\s,;|\t]+/);
        if (parts.length < 2) return;
        let ticker = parts[0].toUpperCase();
        if (!ticker.includes(".")) ticker += ".OL";
        const shares = Number(parts[1].replace(",", "."));
        const gav = parts[2] ? Number(parts[2].replace(",", ".")) : 0;
        if (isNaN(shares)) return;

        let st = appData.stocks.find((s) => s.ticker.toUpperCase() === ticker);
        if (st) {
          st.shares = shares;
          st.in_portfolio = shares > 0;
          if (gav > 0) st.gav = gav;
        } else {
          appData.stocks.push({
            ticker,
            name: ticker,
            exchange: "OSE",
            currency: "NOK",
            sector: "Annet",
            in_portfolio: shares > 0,
            shares,
            gav,
            price: gav,
            value_nok: 0,
            weight_pct: 0,
            rule_status: "Innenfor (< 15 %)",
            portfolio_action: shares > 0 ? "HOLD" : "KANDIDAT",
            portfolio_rationale: "Hurtigimportert til porteføljen.",
            recommendations: []
          });
        }
        count++;
      });
      if (count > 0) {
        els.bulkPasteInput.value = "";
        refreshAllViews(true);
      }
    });

    els.exportJsonBtn.addEventListener("click", () => {
      appData.watchlist = Array.from(watchlistSet);
      const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "recommendations.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    els.resetLocalBtn.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      loadServerData();
    });

    const savedToken = localStorage.getItem(GH_TOKEN_KEY);
    if (savedToken) els.ghTokenInput.value = savedToken;

    els.saveToGithubBtn.addEventListener("click", async () => {
      const token = (els.ghTokenInput.value || "").trim();
      if (!token) {
        els.ghSyncStatus.textContent = "Legg inn et GitHub Personal Access Token først.";
        els.ghSyncStatus.style.color = "#f87171";
        return;
      }
      localStorage.setItem(GH_TOKEN_KEY, token);
      els.ghSyncStatus.textContent = "Lagrer til rolldan/aksjer...";
      els.ghSyncStatus.style.color = "#38bdf8";

      try {
        appData.watchlist = Array.from(watchlistSet);
        const apiUrl = "https://api.github.com/repos/rolldan/aksjer/contents/data/recommendations.json";
        const getRes = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
        });
        if (!getRes.ok) throw new Error(`Kunne ikke hente fil-SHA (${getRes.status})`);
        const fileMeta = await getRes.json();

        const jsonStr = JSON.stringify(appData, null, 2) + "\n";
        const contentB64 = btoa(unescape(encodeURIComponent(jsonStr)));

        const putRes = await fetch(apiUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: "chore(portfolio): manuell oppdatering av aksjeliste og Følg med på fra nettsiden",
            content: contentB64,
            sha: fileMeta.sha,
            branch: "main"
          })
        });
        if (!putRes.ok) throw new Error(`GitHub API feilet (${putRes.status})`);
        els.ghSyncStatus.textContent = "Lagret permanent til GitHub (rolldan/aksjer)!";
        els.ghSyncStatus.style.color = "#34d399";
      } catch (err) {
        els.ghSyncStatus.textContent = `Feil ved lagring til GitHub: ${err.message}`;
        els.ghSyncStatus.style.color = "#f87171";
      }
    });
  }

  function setupTabs() {
    const buttons = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".panel");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        panels.forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.classList.add("active");
      });
    });
  }

  async function loadServerData() {
    try {
      const res = await fetch(`data/recommendations.json?t=${Date.now()}`);
      const rawData = await res.json();
      loadWatchlist(rawData.watchlist || []);
      appData = applyLocalOverrides(rawData);
      watchlistSet.forEach((wt) => ensureStockExists(wt));

      if (appData.metadata && appData.metadata.updated_at) {
        els.lastUpdated.innerHTML = `Oppdatert: <strong>${appData.metadata.updated_at.replace("T", " ").slice(0, 16)} CET</strong>`;
      }

      if (els.brokerFilter.options.length <= 1) {
        const brokers = (appData.metadata && appData.metadata.brokers) || [];
        brokers.forEach((b) => {
          const opt = document.createElement("option");
          opt.value = b;
          opt.textContent = b;
          els.brokerFilter.appendChild(opt);
        });
      }

      refreshAllViews(false);
    } catch (err) {
      els.stocksGrid.innerHTML = `<div class="stock-card">Kunne ikke laste <code>data/recommendations.json</code>: ${err.message}</div>`;
    }
  }

  function init() {
    setupTabs();
    setupWatchlistActions();
    setupEditorActions();

    [els.searchInput, els.brokerFilter, els.ratingFilter, els.ownershipFilter, els.sortSelect].forEach((el) => {
      el.addEventListener("input", renderStocks);
      el.addEventListener("change", renderStocks);
    });

    els.wlSearch.addEventListener("input", renderWatchlist);

    [els.seasSearch, els.seasScope, els.seasMonthFilter, els.seasSort].forEach((el) => {
      el.addEventListener("input", renderSeasonality);
      el.addEventListener("change", renderSeasonality);
    });

    [els.bmSearch, els.bmRelevance, els.bmCategory].forEach((el) => {
      el.addEventListener("input", renderBorsmeldinger);
      el.addEventListener("change", renderBorsmeldinger);
    });

    els.refreshNowBtn.addEventListener("click", loadServerData);

    loadServerData();
    setInterval(loadServerData, 5 * 60 * 1000);
  }

  init();
})();
