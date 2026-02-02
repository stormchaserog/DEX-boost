const state = {
  chain: "ethereum",
  address: "",
  label: "",
  snapshot: null
};

const elements = {
  chain: document.getElementById("chain"),
  address: document.getElementById("address"),
  label: document.getElementById("label"),
  lookupForm: document.getElementById("lookup-form"),
  lookupStatus: document.getElementById("lookup-status"),
  addWatchlist: document.getElementById("add-watchlist"),
  trendScore: document.getElementById("trend-score"),
  tokenSummary: document.getElementById("token-summary"),
  metricLiquidity: document.getElementById("metric-liquidity"),
  metricVolume: document.getElementById("metric-volume"),
  metricTransactions: document.getElementById("metric-transactions"),
  metricMakers: document.getElementById("metric-makers"),
  metricHolders: document.getElementById("metric-holders"),
  metricVisitors: document.getElementById("metric-visitors"),
  metricPrice: document.getElementById("metric-price"),
  metricChange: document.getElementById("metric-change"),
  metricPair: document.getElementById("metric-pair"),
  recommendations: document.getElementById("recommendations"),
  communityForm: document.getElementById("community-form"),
  communityStatus: document.getElementById("community-status"),
  holders: document.getElementById("holders"),
  uniqueMakers: document.getElementById("unique-makers"),
  visitors: document.getElementById("visitors"),
  reactionBullish: document.getElementById("reaction-bullish"),
  reactionNeutral: document.getElementById("reaction-neutral"),
  reactionBearish: document.getElementById("reaction-bearish"),
  watchlistBody: document.getElementById("watchlist-body"),
  refreshWatchlist: document.getElementById("refresh-watchlist")
};

const formatNumber = (value) => {
  if (value === null || value === undefined) {
    return "--";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const formatUsd = (value) => {
  if (value === null || value === undefined) {
    return "--";
  }
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
};

const formatPercent = (value) => {
  if (value === null || value === undefined) {
    return "--";
  }
  const number = Number(value);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
};

const setStatus = (element, message) => {
  element.textContent = message || "";
};

async function fetchSnapshot(chain, address) {
  const response = await fetch(`/api/token/${chain}/${address}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch token data.");
  }
  return data;
}

async function updateCommunity(chain, address, payload) {
  const response = await fetch(`/api/community/${chain}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to update community metrics.");
  }
  return data.community;
}

async function addToWatchlist(chain, address, label) {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chain, address, label })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to add to watchlist.");
  }
  return data;
}

async function fetchTrending() {
  const response = await fetch("/api/trending");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to load watchlist.");
  }
  return data;
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  const { token, metrics, community, score } = snapshot;

  elements.trendScore.textContent = score ? score.total : "--";
  elements.tokenSummary.innerHTML = `
    <strong>${token.symbol}</strong> ${token.name}
    <span class="muted">(${token.chain})</span>
    ${token.pairUrl ? `&middot; <a href="${token.pairUrl}" target="_blank" rel="noreferrer">View pair</a>` : ""}
  `;

  elements.metricLiquidity.textContent = formatUsd(metrics.liquidityUsd);
  elements.metricVolume.textContent = formatUsd(metrics.volume24h);
  elements.metricTransactions.textContent = formatNumber(metrics.transactions24h);
  elements.metricMakers.textContent = formatNumber(score.uniqueMakers);
  elements.metricHolders.textContent = formatNumber(community.holders);
  elements.metricVisitors.textContent = formatNumber(community.visitors24h);
  elements.metricPrice.textContent = formatUsd(metrics.priceUsd);
  elements.metricPair.textContent = token.pairLabel || "--";

  const change = metrics.priceChange24h;
  elements.metricChange.textContent = formatPercent(change);
  elements.metricChange.classList.toggle("positive", change > 0);
  elements.metricChange.classList.toggle("negative", change < 0);

  elements.holders.value = community.holders || 0;
  elements.uniqueMakers.value = community.uniqueMakers || 0;
  elements.visitors.value = community.visitors24h || 0;
  elements.reactionBullish.value = community.reactions.bullish || 0;
  elements.reactionNeutral.value = community.reactions.neutral || 0;
  elements.reactionBearish.value = community.reactions.bearish || 0;

  renderRecommendations(snapshot.recommendations || []);
}

function renderRecommendations(recommendations) {
  elements.recommendations.innerHTML = "";
  if (!recommendations.length) {
    elements.recommendations.innerHTML = `<p class="muted">Your token is trending well. No urgent actions.</p>`;
    return;
  }

  recommendations.forEach((rec) => {
    const card = document.createElement("div");
    card.className = "recommendation-card";
    card.innerHTML = `
      <h4>${rec.title}</h4>
      <p>${rec.detail}</p>
      <p class="muted">Priority: ${rec.priority}</p>
    `;
    elements.recommendations.appendChild(card);
  });
}

function renderWatchlist(data) {
  const tokens = data.tokens || [];
  elements.watchlistBody.innerHTML = "";

  if (!tokens.length) {
    elements.watchlistBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">Add tokens to build the list.</td>
      </tr>
    `;
    return;
  }

  tokens.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.token.symbol} <span class="muted">(${item.token.chain})</span></td>
      <td>${item.score.total}</td>
      <td>${formatUsd(item.metrics.liquidityUsd)}</td>
      <td>${formatUsd(item.metrics.volume24h)}</td>
      <td>${formatNumber(item.metrics.transactions24h)}</td>
      <td>${formatNumber(item.score.uniqueMakers)}</td>
      <td>${formatNumber(item.community.holders)}</td>
      <td>${formatNumber(item.community.visitors24h)}</td>
    `;
    elements.watchlistBody.appendChild(row);
  });
}

elements.lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const chain = elements.chain.value;
  const address = elements.address.value.trim();

  if (!address) {
    setStatus(elements.lookupStatus, "Enter a token address.");
    return;
  }

  setStatus(elements.lookupStatus, "Loading token metrics...");
  try {
    const snapshot = await fetchSnapshot(chain, address);
    renderSnapshot(snapshot);
    state.chain = chain;
    state.address = address;
    setStatus(elements.lookupStatus, "Metrics updated.");
  } catch (error) {
    setStatus(elements.lookupStatus, error.message);
  }
});

elements.addWatchlist.addEventListener("click", async () => {
  const chain = elements.chain.value;
  const address = elements.address.value.trim();
  const label = elements.label.value.trim();

  if (!address) {
    setStatus(elements.lookupStatus, "Enter a token address first.");
    return;
  }

  setStatus(elements.lookupStatus, "Adding to watchlist...");
  try {
    await addToWatchlist(chain, address, label);
    setStatus(elements.lookupStatus, "Added to watchlist.");
    await refreshWatchlist();
  } catch (error) {
    setStatus(elements.lookupStatus, error.message);
  }
});

elements.communityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.address) {
    setStatus(elements.communityStatus, "Load a token first.");
    return;
  }

  const payload = {
    holders: Number(elements.holders.value || 0),
    uniqueMakers: Number(elements.uniqueMakers.value || 0),
    visitors24h: Number(elements.visitors.value || 0),
    reactions: {
      bullish: Number(elements.reactionBullish.value || 0),
      neutral: Number(elements.reactionNeutral.value || 0),
      bearish: Number(elements.reactionBearish.value || 0)
    }
  };

  setStatus(elements.communityStatus, "Updating community metrics...");
  try {
    await updateCommunity(state.chain, state.address, payload);
    const snapshot = await fetchSnapshot(state.chain, state.address);
    renderSnapshot(snapshot);
    setStatus(elements.communityStatus, "Community metrics saved.");
    await refreshWatchlist();
  } catch (error) {
    setStatus(elements.communityStatus, error.message);
  }
});

async function refreshWatchlist() {
  try {
    const data = await fetchTrending();
    renderWatchlist(data);
  } catch (error) {
    elements.watchlistBody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">${error.message}</td>
      </tr>
    `;
  }
}

elements.refreshWatchlist.addEventListener("click", refreshWatchlist);

refreshWatchlist();
