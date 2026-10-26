/**
 * Vercel serverless: YouTube Data API v3 videos.list
 * Env: YOUTUBE_API_KEY (never returned to client)
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    res.status(503).json({
      error: "missing_api_key",
      message: "Set YOUTUBE_API_KEY in Vercel project environment variables."
    });
    return;
  }

  const raw = String((req.query && req.query.ids) || "");
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((id) => /^[A-Za-z0-9_-]{6,64}$/.test(id))
    )
  ].slice(0, 50);

  if (!ids.length) {
    res.status(400).json({ error: "missing_ids", message: "Pass ?ids=id1,id2" });
    return;
  }

  const url =
    "https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=" +
    encodeURIComponent(ids.join(",")) +
    "&key=" +
    encodeURIComponent(key);

  let upstream;
  try {
    upstream = await fetch(url);
  } catch (e) {
    res.status(502).json({ error: "upstream_network", message: "Failed to reach YouTube API" });
    return;
  }

  let body;
  try {
    body = await upstream.json();
  } catch (_) {
    res.status(502).json({ error: "upstream_parse", message: "Invalid YouTube API response" });
    return;
  }

  if (!upstream.ok) {
    const reason =
      (body && body.error && (body.error.status || body.error.message)) ||
      "youtube_api_error";
    const code = upstream.status === 403 ? 403 : upstream.status === 400 ? 400 : 502;
    res.status(code).json({
      error: "youtube_api",
      status: upstream.status,
      reason: String(reason).slice(0, 200)
    });
    return;
  }

  const videos = {};
  for (const item of body.items || []) {
    const id = item.id;
    if (!id) continue;
    videos[id] = {
      viewCount: Number((item.statistics && item.statistics.viewCount) || 0),
      publishedAt: (item.snippet && item.snippet.publishedAt) || "",
      title: (item.snippet && item.snippet.title) || "",
      channelTitle: (item.snippet && item.snippet.channelTitle) || ""
    };
  }

  res.status(200).json({
    fetchedAt: new Date().toISOString(),
    count: Object.keys(videos).length,
    videos
  });
};
