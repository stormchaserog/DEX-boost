const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const DATA_DIR = path.join(__dirname, "data");
const COMMUNITY_FILE = path.join(DATA_DIR, "community.json");
const WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");
const WEIGHTS_FILE = path.join(DATA_DIR, "weights.json");

const DEFAULT_COMMUNITY = { tokens: {} };
const DEFAULT_WATCHLIST = { tokens: [] };
const DEFAULT_WEIGHTS = {
  liquidity: 0.25,
  volume: 0.25,
  transactions: 0.2,
  uniqueMakers: 0.1,
  holders: 0.1,
  engagement: 0.1
};

const SOLANA_CHAIN = "solana";
const CACHE_TTL_MS = 30_000;
const dexCache = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await Promise.all([
    ensureFile(COMMUNITY_FILE, DEFAULT_COMMUNITY),
    ensureFile(WATCHLIST_FILE, DEFAULT_WATCHLIST),
    ensureFile(WEIGHTS_FILE, DEFAULT_WEIGHTS)
  ]);
}

async function ensureFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    await writeJson(filePath, fallback);
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJson(filePath, fallback);
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  const payload = JSON.stringify(data, null, 2);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, payload);
  await fs.rename(tempPath, filePath);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeChain(chain) {
  return String(chain || "").trim().toLowerCase();
}

function normalizeAddress(address) {
  return String(address || "").trim();
}

function enforceSolana(chain) {
  const normalized = normalizeChain(chain);
  if (normalized && normalized !== SOLANA_CHAIN) {
    return { ok: false, chain: normalized };
  }
  return { ok: true, chain: SOLANA_CHAIN };
}

function tokenKey(chain, address) {
  return `${normalizeChain(chain)}:${normalizeAddress(address)}`;
}

function sanitizeCommunity(raw) {
  const reactions = raw.reactions || {};
  return {
    holders: toNumber(raw.holders, 0),
    uniqueMakers: toNumber(raw.uniqueMakers, 0),
    visitors24h: toNumber(raw.visitors24h, 0),
    reactions: {
      bullish: toNumber(reactions.bullish, 0),
      neutral: toNumber(reactions.neutral, 0),
      bearish: toNumber(reactions.bearish, 0)
    },
    updatedAt: raw.updatedAt || null
  };
}

function normalizeWeights(input) {
  const normalized = {};
  const keys = Object.keys(DEFAULT_WEIGHTS);
  let sum = 0;

  keys.forEach((key) => {
    const value = Math.max(0, toNumber(input[key], DEFAULT_WEIGHTS[key]));
    normalized[key] = value;
    sum += value;
  });

  if (sum === 0) {
    return { ...DEFAULT_WEIGHTS };
  }

  keys.forEach((key) => {
    normalized[key] = normalized[key] / sum;
  });

  return normalized;
}

async function fetchDexScreener(address) {
  const cacheKey = address.toLowerCase();
  const cached = dexCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  if (typeof fetch !== "function") {
    throw new Error("Fetch API not available. Use Node 18+.");
  }

  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${address}`,
    { headers: { accept: "application/json" } }
  );

  if (!response.ok) {
    throw new Error(`DexScreener error ${response.status}`);
  }

  const data = await response.json();
  dexCache.set(cacheKey, { data, expiresAt: now + CACHE_TTL_MS });
  return data;
}

function pickBestPair(pairs, chainId) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return null;
  }

  const filtered = chainId
    ? pairs.filter(
        (pair) => normalizeChain(pair?.chainId) === normalizeChain(chainId)
      )
    : pairs;

  if (filtered.length === 0) {
    return null;
  }

  return [...filtered].sort((a, b) => {
    const liquidityA = toNumber(a?.liquidity?.usd, 0);
    const liquidityB = toNumber(b?.liquidity?.usd, 0);
    if (liquidityA !== liquidityB) {
      return liquidityB - liquidityA;
    }
    const volumeA = toNumber(a?.volume?.h24, 0);
    const volumeB = toNumber(b?.volume?.h24, 0);
    return volumeB - volumeA;
  })[0];
}

function buildTokenInfo(pair, chain, address) {
  const baseToken = pair?.baseToken || {};
  const quoteToken = pair?.quoteToken || {};
  return {
    chain,
    address,
    symbol: baseToken.symbol || "UNKNOWN",
    name: baseToken.name || "Unknown token",
    pairLabel: baseToken.symbol && quoteToken.symbol
      ? `${baseToken.symbol}/${quoteToken.symbol}`
      : null,
    dexId: pair?.dexId || null,
    chainId: pair?.chainId || null,
    pairAddress: pair?.pairAddress || null,
    pairUrl: pair?.url || null,
    logoUrl: pair?.info?.imageUrl || null
  };
}

function buildMetrics(pair) {
  const buys24h = toNumber(pair?.txns?.h24?.buys, 0);
  const sells24h = toNumber(pair?.txns?.h24?.sells, 0);
  const transactions24h = buys24h + sells24h;

  return {
    liquidityUsd: toNumber(pair?.liquidity?.usd, 0),
    volume24h: toNumber(pair?.volume?.h24, 0),
    volume6h: toNumber(pair?.volume?.h6, 0),
    volume1h: toNumber(pair?.volume?.h1, 0),
    buys24h,
    sells24h,
    transactions24h,
    priceUsd: toNumber(pair?.priceUsd, null),
    priceChange24h: toNumber(pair?.priceChange?.h24, 0)
  };
}

function computeTrendScore(metrics, community, weights) {
  const logScore = (value) => Math.log10(1 + Math.max(0, value));
  const reactionScore =
    community.reactions.bullish -
    community.reactions.bearish +
    community.reactions.neutral * 0.1;
  const uniqueMakers =
    community.uniqueMakers > 0 ? community.uniqueMakers : metrics.transactions24h;
  const engagementValue = Math.max(0, community.visitors24h + reactionScore * 20);

  const breakdown = {
    liquidity: logScore(metrics.liquidityUsd) * weights.liquidity,
    volume: logScore(metrics.volume24h) * weights.volume,
    transactions: logScore(metrics.transactions24h) * weights.transactions,
    uniqueMakers: logScore(uniqueMakers) * weights.uniqueMakers,
    holders: logScore(community.holders) * weights.holders,
    engagement: logScore(engagementValue) * weights.engagement
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    total: Math.round(total * 1000) / 10,
    breakdown,
    engagementValue,
    uniqueMakers
  };
}

function buildRecommendations(metrics, community) {
  const recommendations = [];
  const uniqueMakers =
    community.uniqueMakers > 0 ? community.uniqueMakers : metrics.transactions24h;
  const totalReactions =
    community.reactions.bullish +
    community.reactions.neutral +
    community.reactions.bearish;

  if (
    community.holders === 0 &&
    community.uniqueMakers === 0 &&
    community.visitors24h === 0 &&
    totalReactions === 0
  ) {
    recommendations.push({
      priority: "high",
      title: "Add community metrics",
      detail: "Update holders, unique makers, visitors, and reactions for better scoring."
    });
  }

  if (metrics.liquidityUsd < 50_000) {
    recommendations.push({
      priority: "high",
      title: "Increase liquidity depth",
      detail: "Add liquidity or incentivize LPs to stabilize price action."
    });
  }

  if (metrics.volume24h < 25_000) {
    recommendations.push({
      priority: "high",
      title: "Drive 24h volume",
      detail: "Run a trading contest or coordinated buys to lift volume."
    });
  }

  if (metrics.transactions24h < 250) {
    recommendations.push({
      priority: "medium",
      title: "Boost transaction count",
      detail: "Launch micro-buy campaigns to raise on-chain activity."
    });
  }

  if (uniqueMakers < 100) {
    recommendations.push({
      priority: "medium",
      title: "Grow unique makers",
      detail: "Reward first-time buyers with XP, points, or whitelist perks."
    });
  }

  if (community.holders < 1000) {
    recommendations.push({
      priority: "medium",
      title: "Increase holders",
      detail: "Offer staking, airdrops, or referral rewards for new holders."
    });
  }

  if (community.visitors24h < 1000) {
    recommendations.push({
      priority: "low",
      title: "Drive DEX Screener visits",
      detail: "Share the DEX Screener link in socials and community channels."
    });
  }

  if (totalReactions < 50) {
    recommendations.push({
      priority: "low",
      title: "Increase community sentiment",
      detail: "Host AMAs and polls to encourage reactions."
    });
  }

  return recommendations;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/token/:chain/:address", async (req, res) => {
  try {
    const chainCheck = enforceSolana(req.params.chain);
    const address = normalizeAddress(req.params.address);
    if (!chainCheck.ok) {
      return res.status(400).json({ error: "Only Solana tokens are supported." });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required." });
    }

    const [dexData, communityStore, weights] = await Promise.all([
      fetchDexScreener(address),
      readJson(COMMUNITY_FILE, DEFAULT_COMMUNITY),
      readJson(WEIGHTS_FILE, DEFAULT_WEIGHTS)
    ]);

    const pair = pickBestPair(dexData.pairs || [], SOLANA_CHAIN);
    if (!pair) {
      return res.status(404).json({ error: "Token not found on Solana DexScreener." });
    }

    const token = buildTokenInfo(pair, SOLANA_CHAIN, address);
    const metrics = buildMetrics(pair);
    const community = sanitizeCommunity(
      communityStore.tokens[tokenKey(SOLANA_CHAIN, address)] || {}
    );
    const score = computeTrendScore(metrics, community, weights);
    const recommendations = buildRecommendations(metrics, community);

    return res.json({
      token,
      metrics,
      community,
      score,
      recommendations,
      source: { fetchedAt: new Date().toISOString() }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/community/:chain/:address", async (req, res) => {
  try {
    const chainCheck = enforceSolana(req.params.chain);
    const address = normalizeAddress(req.params.address);
    if (!chainCheck.ok) {
      return res.status(400).json({ error: "Only Solana tokens are supported." });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required." });
    }

    const communityStore = await readJson(COMMUNITY_FILE, DEFAULT_COMMUNITY);
    const community = sanitizeCommunity(
      communityStore.tokens[tokenKey(SOLANA_CHAIN, address)] || {}
    );
    return res.json({ community });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/community/:chain/:address", async (req, res) => {
  try {
    const chainCheck = enforceSolana(req.params.chain);
    const address = normalizeAddress(req.params.address);
    if (!chainCheck.ok) {
      return res.status(400).json({ error: "Only Solana tokens are supported." });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required." });
    }

    const payload = req.body || {};
    const communityStore = await readJson(COMMUNITY_FILE, DEFAULT_COMMUNITY);
    const key = tokenKey(SOLANA_CHAIN, address);
    const existing = sanitizeCommunity(communityStore.tokens[key] || {});

    const updated = {
      holders: toNumber(payload.holders, existing.holders),
      uniqueMakers: toNumber(payload.uniqueMakers, existing.uniqueMakers),
      visitors24h: toNumber(payload.visitors24h, existing.visitors24h),
      reactions: {
        bullish: toNumber(payload.reactions?.bullish, existing.reactions.bullish),
        neutral: toNumber(payload.reactions?.neutral, existing.reactions.neutral),
        bearish: toNumber(payload.reactions?.bearish, existing.reactions.bearish)
      },
      updatedAt: new Date().toISOString()
    };

    communityStore.tokens[key] = updated;
    await writeJson(COMMUNITY_FILE, communityStore);

    return res.json({ community: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/watchlist", async (req, res) => {
  try {
    const list = await readJson(WATCHLIST_FILE, DEFAULT_WATCHLIST);
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/watchlist", async (req, res) => {
  try {
    const chainCheck = enforceSolana(req.body?.chain);
    const address = normalizeAddress(req.body?.address);
    const label = String(req.body?.label || "").trim() || null;
    if (!chainCheck.ok) {
      return res.status(400).json({ error: "Only Solana tokens are supported." });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required." });
    }

    const list = await readJson(WATCHLIST_FILE, DEFAULT_WATCHLIST);
    const chain = chainCheck.chain;
    const key = tokenKey(chain, address);

    if (!list.tokens.find((token) => token.id === key)) {
      list.tokens.push({ id: key, chain, address, label });
      await writeJson(WATCHLIST_FILE, list);
    }

    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/watchlist/:chain/:address", async (req, res) => {
  try {
    const chainCheck = enforceSolana(req.params.chain);
    const address = normalizeAddress(req.params.address);
    if (!chainCheck.ok) {
      return res.status(400).json({ error: "Only Solana tokens are supported." });
    }
    if (!address) {
      return res.status(400).json({ error: "Address is required." });
    }

    const list = await readJson(WATCHLIST_FILE, DEFAULT_WATCHLIST);
    const key = tokenKey(SOLANA_CHAIN, address);
    list.tokens = list.tokens.filter((token) => token.id !== key);
    await writeJson(WATCHLIST_FILE, list);
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/weights", async (req, res) => {
  try {
    const weights = await readJson(WEIGHTS_FILE, DEFAULT_WEIGHTS);
    return res.json({ weights });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put("/api/weights", async (req, res) => {
  try {
    const current = await readJson(WEIGHTS_FILE, DEFAULT_WEIGHTS);
    const normalized = normalizeWeights({ ...current, ...(req.body || {}) });
    await writeJson(WEIGHTS_FILE, normalized);
    return res.json({ weights: normalized });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/trending", async (req, res) => {
  try {
    const [list, weights, communityStore] = await Promise.all([
      readJson(WATCHLIST_FILE, DEFAULT_WATCHLIST),
      readJson(WEIGHTS_FILE, DEFAULT_WEIGHTS),
      readJson(COMMUNITY_FILE, DEFAULT_COMMUNITY)
    ]);

    const snapshots = await Promise.all(
      list.tokens.map(async (token) => {
        try {
          if (normalizeChain(token.chain) !== SOLANA_CHAIN) {
            return { id: token.id, chain: token.chain, address: token.address, error: "Non-Solana token skipped." };
          }
          const dexData = await fetchDexScreener(token.address);
          const pair = pickBestPair(dexData.pairs || [], SOLANA_CHAIN);
          if (!pair) {
            return { id: token.id, chain: token.chain, address: token.address, error: "Token not found on Solana DexScreener." };
          }
          const metrics = buildMetrics(pair);
          const community = sanitizeCommunity(communityStore.tokens[token.id] || {});
          const score = computeTrendScore(metrics, community, weights);
          const info = buildTokenInfo(pair, SOLANA_CHAIN, token.address);
          return { id: token.id, token: info, metrics, community, score };
        } catch (error) {
          return { id: token.id, chain: token.chain, address: token.address, error: error.message };
        }
      })
    );

    const valid = snapshots.filter((snapshot) => !snapshot.error);
    valid.sort((a, b) => b.score.total - a.score.total);

    return res.json({
      updatedAt: new Date().toISOString(),
      tokens: valid,
      errors: snapshots.filter((snapshot) => snapshot.error)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDataFiles()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Token trending platform running on ${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
