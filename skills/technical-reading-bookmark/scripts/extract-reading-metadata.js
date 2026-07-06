#!/usr/bin/env node
"use strict";

const DEFAULT_ENGLISH_WPM = 225;
const DEFAULT_CHINESE_CPM = 500;
const DEFAULT_PERSONAL_MULTIPLIER = 1.3;
const DEFAULT_X_ARTICLE_ENGLISH_WPM = 200;
const DEFAULT_X_ARTICLE_RETRIES = 2;
const DEFAULT_X_ARTICLE_RETRY_DELAY_MS = 500;
const X_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const X_TWEET_RESULT_QUERY_ID = "SgZWKwvBiOKrSC0QeOGvXw";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function parseJsonAssignment(html, variableName) {
  const marker = `${variableName}=`;
  const start = String(html || "").indexOf(marker);
  if (start < 0) return undefined;

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function metaContent(html, names) {
  const values = [];
  const pattern = /<meta\b[^>]*>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const tag = match[0];
    const name = attrValue(tag, "name") || attrValue(tag, "property");
    if (!name || !names.includes(name.toLowerCase())) continue;
    const content = attrValue(tag, "content");
    if (content) values.push(decodeEntities(content));
  }
  return values;
}

function titleFromHtml(html) {
  const jsonLdTitle = jsonLdObjects(html)
    .flatMap((object) => collectTitles(object))
    .find(Boolean);
  const metaTitle = metaContent(html, ["og:title", "twitter:title"]).find(Boolean);
  const titleTag = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return cleanTitle(jsonLdTitle || metaTitle || stripTags(titleTag || ""));
}

function cleanTitle(value) {
  return decodeEntities(value)
    .replace(/\s+/g, " ")
    .replace(/\s+[|-]\s+(YouTube|GitHub|Claude|Anthropic|OpenAI|Google Research|Vercel)$/i, "")
    .trim();
}

function attrValue(tag, attr) {
  const pattern = new RegExp(`\\b${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return tag.match(pattern)?.[2];
}

function blocksForTag(html, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...String(html || "").matchAll(pattern)].map((match) => stripTags(match[1]));
}

function scriptJsonByVar(html, variableName) {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*=\\s*({[\\s\\S]*?})\\s*;`, "g");
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      return JSON.parse(match[1]);
    } catch {
      continue;
    }
  }
  return undefined;
}

function isXHost(hostname) {
  const host = String(hostname || "").replace(/^www\./, "").toLowerCase();
  return host === "x.com" || host === "twitter.com";
}

function xStatusIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isXHost(parsed.hostname)) return undefined;
    return parsed.pathname.match(/\/status\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

function xArticleIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isXHost(parsed.hostname)) return undefined;
    return parsed.pathname.match(/^\/i\/article\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

function xArticleUrlFromInitialState(html, statusId) {
  const state = parseJsonAssignment(html, "window.__INITIAL_STATE__");
  const urls = state?.entities?.tweets?.entities?.[statusId]?.entities?.urls || [];
  return urls
    .map((entry) => entry.expanded_url || entry.url)
    .find((value) => xArticleIdFromUrl(value));
}

function xArticleFromTweetResultPayload(payload) {
  const article = payload?.data?.tweetResult?.result?.article?.article_results?.result;
  if (!article) return undefined;

  const blockText = article.content_state?.blocks
    ?.map((block) => block.text)
    .filter((text) => meaningfulLength(text) > 0)
    .join("\n\n");
  const text = [article.plain_text, blockText, article.preview_text]
    .map((candidate) => String(candidate || "").trim())
    .find((candidate) => meaningfulLength(candidate) >= 80);
  if (!text) return undefined;

  return {
    id: article.rest_id || article.id,
    title: cleanTitle(article.title || ""),
    text,
    source: "x_tweet_article_graphql",
  };
}

function xGraphqlUrl(queryId, operationName, variables, features, fieldToggles) {
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
    fieldToggles: JSON.stringify(fieldToggles),
  });
  return `https://x.com/i/api/graphql/${queryId}/${operationName}?${params}`;
}

async function activateXGuestToken(fetcher = fetch) {
  const response = await fetcher("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: {
      authorization: `Bearer ${X_BEARER_TOKEN}`,
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`X guest activation HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.guest_token) throw new Error("X guest activation did not return a guest token");
  return body.guest_token;
}

async function fetchXArticleFromTweetId(tweetId, fetcher = fetch) {
  const guestToken = await activateXGuestToken(fetcher);
  const features = {
    creator_subscriptions_tweet_preview_api_enabled: true,
    premium_content_api_read_enabled: true,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: true,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    rweb_conversational_replies_downvote_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: true,
    rweb_cashtags_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_enhance_cards_enabled: true,
  };
  const fieldToggles = {
    withArticleRichContentState: true,
    withArticlePlainText: true,
    withArticleSummaryText: false,
    withArticleVoiceOver: false,
    withGrokAnalyze: false,
    withDisallowedReplyControls: false,
  };
  const variables = {
    tweetId,
    withCommunity: false,
    includePromotedContent: false,
    withVoice: false,
  };
  const response = await fetcher(xGraphqlUrl(X_TWEET_RESULT_QUERY_ID, "TweetResultByRestId", variables, features, fieldToggles), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${X_BEARER_TOKEN}`,
      "user-agent": "Mozilla/5.0",
      "x-guest-token": guestToken,
    },
  });
  if (!response.ok) throw new Error(`X tweet article HTTP ${response.status}`);
  return xArticleFromTweetResultPayload(await response.json());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchXArticleFromTweetIdWithRetry(tweetId, options = {}) {
  const fetcher = options.fetcher || fetch;
  const attempts = Math.max(1, Number(options.xArticleRetries || DEFAULT_X_ARTICLE_RETRIES));
  const delayMs = Math.max(0, Number(options.xArticleRetryDelayMs ?? DEFAULT_X_ARTICLE_RETRY_DELAY_MS));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return {
        article: await fetchXArticleFromTweetId(tweetId, fetcher),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await sleep(delayMs);
    }
  }

  return {
    article: undefined,
    attempts,
    error: lastError?.message || String(lastError || "unknown X article error"),
  };
}

function parseIsoDuration(value) {
  const match = String(value || "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return undefined;
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match;
  return Math.round((Number(days) * 86400) + (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds));
}

function collectJsonLdText(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdText(item, output);
    return output;
  }

  const rawType = value["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isArticle = types.some((type) => /article|blogposting|newsarticle|posting/i.test(String(type || "")));
  if (isArticle) {
    for (const key of ["headline", "description", "articleBody", "text"]) {
      if (typeof value[key] === "string") output.push(value[key]);
    }
  }
  for (const child of Object.values(value)) collectJsonLdText(child, output);
  return output;
}

function collectTitles(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectTitles(item, output);
    return output;
  }

  for (const key of ["headline", "name", "title"]) {
    if (typeof value[key] === "string") output.push(value[key]);
  }
  for (const child of Object.values(value)) collectTitles(child, output);
  return output;
}

function jsonLdObjects(html) {
  const pattern = /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  const objects = [];
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      objects.push(JSON.parse(decodeEntities(match[2])));
    } catch {
      // Ignore malformed publisher metadata; HTML extraction still provides a fallback.
    }
  }
  return objects;
}

function jsonLdCandidates(html) {
  const candidates = [];
  for (const object of jsonLdObjects(html)) {
    candidates.push(...collectJsonLdText(object));
  }
  return candidates.map((candidate) => stripTags(candidate)).filter(Boolean);
}

function collectVideoDurations(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectVideoDurations(item, output);
    return output;
  }

  const rawType = value["@type"];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isVideo = types.some((type) => /videoobject|movie|episode|clip/i.test(String(type || "")));
  if (isVideo) {
    const seconds = parseIsoDuration(value.duration) || Number(value.duration);
    if (Number.isFinite(seconds) && seconds > 0) output.push(seconds);
  }
  for (const child of Object.values(value)) collectVideoDurations(child, output);
  return output;
}

function detectVideoDuration(html, url) {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
    const playerResponse = scriptJsonByVar(html, "ytInitialPlayerResponse");
    const seconds = Number(playerResponse?.videoDetails?.lengthSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      return { source: "youtube_player_response", seconds };
    }
  }

  const jsonLdSeconds = jsonLdObjects(html).flatMap((object) => collectVideoDurations(object));
  if (jsonLdSeconds.length > 0) {
    return { source: "json_ld_video_duration", seconds: jsonLdSeconds[0] };
  }

  const metaDurations = metaContent(html, ["video:duration", "og:video:duration", "duration"])
    .map((value) => Number(value))
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  if (metaDurations.length > 0) {
    return { source: "video_meta_duration", seconds: metaDurations[0] };
  }

  return undefined;
}

function applyPersonalMultiplier(minutes, multiplier = DEFAULT_PERSONAL_MULTIPLIER) {
  return Number((minutes * Number(multiplier || 1)).toFixed(2));
}

function estimateFromSeconds(seconds, source, options = {}) {
  const baseMinutes = Number((seconds / 60).toFixed(2));
  const rawMinutes = applyPersonalMultiplier(baseMinutes, options.personalMultiplier);
  return {
    estimated_minutes: Math.max(1, Math.ceil(rawMinutes)),
    raw_minutes: rawMinutes,
    base_minutes: baseMinutes,
    duration_seconds: Math.round(seconds),
    mode: "video_duration",
    personal_multiplier: Number(options.personalMultiplier || DEFAULT_PERSONAL_MULTIPLIER),
    source,
  };
}

function meaningfulLength(text) {
  return countReadableUnits(text).english_words + countReadableUnits(text).chinese_chars;
}

function extractReadableText(html) {
  const candidates = [
    ...jsonLdCandidates(html),
    ...blocksForTag(html, "article"),
    ...blocksForTag(html, "main"),
  ].filter((candidate) => meaningfulLength(candidate) >= 80);

  if (candidates.length > 0) {
    return candidates.sort((a, b) => meaningfulLength(b) - meaningfulLength(a))[0];
  }

  const meta = metaContent(html, ["og:description", "twitter:description", "description"]).join(" ");
  if (meaningfulLength(meta) >= 20) return meta.replace(/\s+/g, " ").trim();

  return stripTags(html);
}

function countReadableUnits(text) {
  const normalized = String(text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .normalize("NFKC");
  const chineseChars = normalized.match(/\p{Script=Han}/gu)?.length || 0;
  const withoutHan = normalized.replace(/\p{Script=Han}/gu, " ");
  const englishWords = withoutHan.match(/[A-Za-z0-9]+(?:[._'/-][A-Za-z0-9]+)*/g)?.filter((word) => /[A-Za-z]/.test(word)).length || 0;
  return { english_words: englishWords, chinese_chars: chineseChars };
}

function estimateFromText(text, options = {}) {
  const englishWpm = Number(options.englishWpm || DEFAULT_ENGLISH_WPM);
  const chineseCpm = Number(options.chineseCpm || DEFAULT_CHINESE_CPM);
  const personalMultiplier = Number(options.personalMultiplier || DEFAULT_PERSONAL_MULTIPLIER);
  const counts = countReadableUnits(text);
  const englishMinutes = counts.english_words / englishWpm;
  const chineseMinutes = counts.chinese_chars / chineseCpm;
  const baseMinutes = englishMinutes + chineseMinutes;
  const rawMinutes = applyPersonalMultiplier(baseMinutes, personalMultiplier);
  return {
    estimated_minutes: Math.max(1, Math.ceil(rawMinutes)),
    raw_minutes: Number(rawMinutes.toFixed(2)),
    base_minutes: Number(baseMinutes.toFixed(2)),
    english_minutes: Number(englishMinutes.toFixed(2)),
    chinese_minutes: Number(chineseMinutes.toFixed(2)),
    personal_multiplier: personalMultiplier,
    counts,
    rates: {
      english_wpm: englishWpm,
      chinese_cpm: chineseCpm,
    },
  };
}

function estimateFromXArticleText(text, options = {}) {
  return estimateFromText(text, {
    ...options,
    englishWpm: options.englishWpm || DEFAULT_X_ARTICLE_ENGLISH_WPM,
  });
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "technical-reading-bookmark-metadata/0.1 (+https://notion.so)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      final_url: response.url,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(argv) {
  const args = { json: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--human") args.json = false;
    else if (value === "--json") args.json = true;
    else if (value === "--english-wpm") args.englishWpm = argv[++index];
    else if (value === "--chinese-cpm") args.chineseCpm = argv[++index];
    else if (value === "--personal-multiplier") args.personalMultiplier = argv[++index];
    else if (!args.url) args.url = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (!args.url) throw new Error("Usage: extract-reading-metadata.js <url> [--json|--human] [--english-wpm N] [--chinese-cpm N] [--personal-multiplier N]");
  return args;
}

async function estimateUrl(url, options = {}) {
  const fetched = await fetchHtml(url);
  const statusId = xStatusIdFromUrl(fetched.final_url || url);
  let xArticleLookup;
  if (statusId) {
    xArticleLookup = await fetchXArticleFromTweetIdWithRetry(statusId, options);
    const article = xArticleLookup.article;
    if (article) {
      return {
        ok: true,
        url,
        final_url: xArticleUrlFromInitialState(fetched.html, statusId) || fetched.final_url,
        title: article.title || titleFromHtml(fetched.html),
        mode: "x_article_text",
        source: article.source,
        article_id: article.id,
        x_article_attempts: xArticleLookup.attempts,
        ...estimateFromXArticleText(article.text, options),
        extracted_chars: article.text.length,
      };
    }
  }

  const title = titleFromHtml(fetched.html);
  const video = detectVideoDuration(fetched.html, fetched.final_url || url);
  if (video) {
    return {
      ok: true,
      url,
      final_url: fetched.final_url,
      title,
      ...estimateFromSeconds(video.seconds, video.source, options),
    };
  }

  const text = extractReadableText(fetched.html);
  return {
    ok: true,
    url,
    final_url: fetched.final_url,
    title,
    mode: "article_text",
    warnings: xArticleLookup?.error ? [`X article extraction failed after ${xArticleLookup.attempts} attempt(s): ${xArticleLookup.error}`] : undefined,
    ...estimateFromText(text, options),
    extracted_chars: text.length,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await estimateUrl(args.url, args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.estimated_minutes} min`);
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: { message: error.message } }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  activateXGuestToken,
  countReadableUnits,
  detectVideoDuration,
  applyPersonalMultiplier,
  estimateFromText,
  estimateFromXArticleText,
  estimateFromSeconds,
  extractReadableText,
  estimateUrl,
  fetchXArticleFromTweetId,
  fetchXArticleFromTweetIdWithRetry,
  parseIsoDuration,
  titleFromHtml,
  xArticleFromTweetResultPayload,
  xArticleIdFromUrl,
  xArticleUrlFromInitialState,
  xStatusIdFromUrl,
};
