(function () {
  let appData = null;

  const els = {
    lastUpdated: document.getElementById("last-updated-badge"),
    searchInput: document.getElementById("search-input"),
    brokerFilter: document.getElementById("broker-filter"),
    ratingFilter: document.getElementById("rating-filter"),
    ownershipFilter: document.getElementById("ownership-filter"),
    sortSelect: document.getElementById("sort-select"),
    stocksGrid: document.getElementById("stocks-grid"),
    resultsSummary: document.getElementById("results-summary"),
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
    els.resultsSummary.textContent = `Viser ${list.length} aksjer og ${totalRecsShown} megleranbefalinger.`;

    els.stocksGrid.innerHTML = list
      .map(({ stock, stats }) => {
        const avgTarget =
          stats.filteredRecs.length > 0
            ? stats.filteredRecs.reduce((acc, r) => acc + r.target, 0) / stats.filteredRecs.length
            : 0;
        const upsideCls = stats.avgUpside >= 0 ? "upside-pos" : "upside-neg";
        const upsidePrefix = stats.avgUpside >= 0 ? "+" : "";
        const isBreach = (stock.rule_status || "").toUpperCase().includes("BRUDD");

        const recsHtml = stats.filteredRecs
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
          .join("");

        return `
          <article class="stock-card">
            <div class="stock-header">
              <div>
                <div class="stock-title">${stock.name} <span style="color: var(--text-muted); font-weight: 500;">(${stock.ticker})</span></div>
                <div class="stock-meta">${stock.exchange} &bull; ${stock.sector} &bull; ${
          stock.in_portfolio ? `I porteføljen (${formatNumber(stock.weight_pct, 2)} %)` : "Kandidat utenfor porteføljen"
        }</div>
              </div>
              <span class="badge ${ratingBadgeClass(stock.portfolio_action)}">${stock.portfolio_action}</span>
            </div>

            <div class="stock-metrics">
              <div class="metric-item">
                <span>Siste kurs</span>
                <strong>${formatNumber(stock.price, 2)} ${stock.currency}</strong>
              </div>
              <div class="metric-item">
                <span>Snitt kursmål (${stats.filteredRecs.length})</span>
                <strong>${formatNumber(avgTarget, 2)} ${stock.currency}</strong>
              </div>
              <div class="metric-item">
                <span>Snitt oppside</span>
                <strong class="${upsideCls}">${upsidePrefix}${formatNumber(stats.avgUpside, 1)} %</strong>
              </div>
            </div>

            <div class="portfolio-rule-box ${isBreach ? "breach" : ""}">
              <strong>Regelstatus (${stock.rule_status}):</strong> ${stock.portfolio_rationale}
            </div>

            <div class="rec-list">
              ${recsHtml}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderRebalanceAndSectors() {
    if (!appData) return;

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
      els.newsTbody.innerHTML = `<tr><td colspan="4" style="color: var(--text-muted);">Ingen nye RSS-elementer registrert ennå. Kjør <code>python3 scripts/fetch_recommendations.py</code> for å oppdatere.</td></tr>`;
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

  async function init() {
    setupTabs();
    try {
      const res = await fetch("data/recommendations.json");
      appData = await res.json();

      if (appData.metadata && appData.metadata.updated_at) {
        els.lastUpdated.innerHTML = `Oppdatert: <strong>${appData.metadata.updated_at.replace("T", " ").slice(0, 16)} CET</strong>`;
      }

      const brokers = (appData.metadata && appData.metadata.brokers) || [];
      brokers.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        els.brokerFilter.appendChild(opt);
      });

      [els.searchInput, els.brokerFilter, els.ratingFilter, els.ownershipFilter, els.sortSelect].forEach((el) => {
        el.addEventListener("input", renderStocks);
        el.addEventListener("change", renderStocks);
      });

      renderStocks();
      renderRebalanceAndSectors();
      renderModelsAndNews();
    } catch (err) {
      els.stocksGrid.innerHTML = `<div class="stock-card">Kunne ikke laste <code>data/recommendations.json</code>: ${err.message}</div>`;
    }
  }

  init();
})();
