/**
 * TokPortal Job Notifier
 * ----------------------
 * Polls the TokPortal available-bundles endpoint every 15 seconds.
 * Detects new bundle IDs and sends Discord webhook notifications.
 *
 * Environment Variables:
 *   TOKPORTAL_CM_ID       - Your cmId for the TokPortal API (required)
 *   DISCORD_WEBHOOK_URL   - Discord webhook URL for notifications (required)
 *   TOKPORTAL_COOKIE      - Full Cookie header string if auth is required (optional)
 *   POLL_INTERVAL_MS      - Poll interval in milliseconds (default: 15000)
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  cmId: process.env.TOKPORTAL_CM_ID,
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
  cookie: process.env.TOKPORTAL_COOKIE || "",          // Optional: session cookie
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "15000", 10),
  baseUrl: "https://app.tokportal.com/api/manager/available-bundles",
};

// ─── Validate required env vars ───────────────────────────────────────────────

if (!CONFIG.cmId) {
  console.error("❌ Missing required env var: TOKPORTAL_CM_ID");
  process.exit(1);
}
if (!CONFIG.discordWebhookUrl) {
  console.error("❌ Missing required env var: DISCORD_WEBHOOK_URL");
  process.exit(1);
}

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {Set<string>} In-memory store of previously seen bundle IDs */
const seenBundleIds = new Set();

/** Track whether this is the first poll (avoid false positives on startup) */
let isFirstPoll = true;

// ─── Notifiers ────────────────────────────────────────────────────────────────

/**
 * Send a Discord webhook notification for a new bundle.
 * @param {object} bundle - The new bundle object from the API
 */
async function notifyDiscord(bundle) {
  const payload = {
    username: "TokPortal Notifier 🔔",
    embeds: [
      {
        title: "🆕 New Bundle Available!",
        color: 0x00bfff, // Bright blue
        fields: [
          {
            name: "Bundle ID",
            value: `\`${bundle.id}\``,
            inline: true,
          },
          // Add more fields here as you learn the bundle object shape
          // e.g. { name: "Title", value: bundle.title || "N/A", inline: true }
        ],
        description: bundle.title
          ? `**${bundle.title}**`
          : "A new bundle has appeared on TokPortal.",
        timestamp: new Date().toISOString(),
        footer: { text: `cmId: ${CONFIG.cmId}` },
      },
    ],
  };

  try {
    const res = await fetch(CONFIG.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`⚠️  Discord webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error("⚠️  Discord webhook error:", err.message);
  }
}

/**
 * ─── Notification Router ──────────────────────────────────────────────────────
 * Call all notification channels here. Add new channels (SMS, email, etc.)
 * by defining a new async function and calling it below.
 *
 * @param {object} bundle - The new bundle object
 */
async function sendNotifications(bundle) {
  // Console log (always runs)
  console.log(`🔔 NEW BUNDLE DETECTED [${new Date().toISOString()}]`, bundle);

  // Discord
  await notifyDiscord(bundle);

  // ── Add more notifiers here ──────────────────────────────────────────────
  // await notifySlack(bundle);
  // await notifySMS(bundle);
  // await notifyEmail(bundle);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

/**
 * Build request headers. Extend this if TokPortal requires auth tokens.
 */
function buildHeaders() {
  const headers = {
    Accept: "application/json",
    "User-Agent": "TokPortal-Notifier/1.0",
  };

  // Include cookie if provided (session-based auth)
  if (CONFIG.cookie) {
    headers["Cookie"] = CONFIG.cookie;
  }

  // ── Add bearer token support here if needed ──────────────────────────────
  // const token = process.env.TOKPORTAL_TOKEN;
  // if (token) headers["Authorization"] = `Bearer ${token}`;

  return headers;
}

/**
 * Fetch available bundles from TokPortal.
 * @returns {Promise<object[]>} Array of bundle objects, or [] on error
 */
async function fetchBundles() {
  const url = `${CONFIG.baseUrl}?country=USA&cmId=${CONFIG.cmId}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
    });

    if (!res.ok) {
      console.error(`⚠️  API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    // ── Adjust this path to match the actual response shape ─────────────────
    // Examples:
    //   if data is an array:          return data;
    //   if data = { bundles: [...] }: return data.bundles;
    //   if data = { data: [...] }:    return data.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.bundles)) return data.bundles;
    if (Array.isArray(data?.data)) return data.data;

    console.warn("⚠️  Unexpected response shape:", JSON.stringify(data).slice(0, 200));
    return [];
  } catch (err) {
    console.error("⚠️  Fetch error:", err.message);
    return [];
  }
}

/**
 * Main poll function — fetches bundles and triggers notifications for new ones.
 */
async function poll() {
  const bundles = await fetchBundles();

  if (bundles.length === 0 && !isFirstPoll) {
    console.log(`[${new Date().toISOString()}] No bundles returned (or API error).`);
    return;
  }

  let newCount = 0;

  for (const bundle of bundles) {
    // ── Adjust "bundle.id" if the ID field has a different name ─────────────
    const id = String(bundle.id ?? bundle._id ?? bundle.bundleId ?? JSON.stringify(bundle));

    if (!seenBundleIds.has(id)) {
      seenBundleIds.add(id);

      if (!isFirstPoll) {
        // Only notify after the first poll (first poll seeds the known set)
        await sendNotifications(bundle);
        newCount++;
      }
    }
  }

  if (isFirstPoll) {
    console.log(
      `✅ Initialized with ${seenBundleIds.size} existing bundle(s). Watching for new ones...`
    );
    isFirstPoll = false;
  } else if (newCount === 0) {
    console.log(`[${new Date().toISOString()}] No new bundles. Known: ${seenBundleIds.size}`);
  }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

console.log("🚀 TokPortal Notifier starting...");
console.log(`   cmId:     ${CONFIG.cmId}`);
console.log(`   Interval: ${CONFIG.pollIntervalMs / 1000}s`);
console.log(`   Discord:  ${CONFIG.discordWebhookUrl ? "✅ configured" : "❌ missing"}`);
console.log("");

// Run immediately, then on interval
poll();
setInterval(poll, CONFIG.pollIntervalMs);
