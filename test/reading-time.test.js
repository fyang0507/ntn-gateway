const assert = require("node:assert/strict");
const test = require("node:test");

const {
  countReadableUnits,
  detectVideoDuration,
  estimateFromText,
  estimateFromSeconds,
  extractReadableText,
  parseIsoDuration,
  titleFromHtml,
  xArticleFromTweetResultPayload,
  xArticleIdFromUrl,
  xArticleUrlFromInitialState,
  xStatusIdFromUrl,
  estimateUrl,
} = require("../skills/technical-reading-bookmark/scripts/extract-reading-metadata");

test("counts English words and Chinese characters separately", () => {
  const counts = countReadableUnits("OpenAI released GPT-5. 这是一个技术博客，用中文解释模型能力。");

  assert.equal(counts.english_words, 3);
  assert.equal(counts.chinese_chars, 17);
});

test("estimates mixed-language reading time additively", () => {
  const english = "agent ".repeat(450);
  const chinese = "技术".repeat(500);
  const result = estimateFromText(`${english} ${chinese}`, { englishWpm: 225, chineseCpm: 500 });

  assert.equal(result.estimated_minutes, 6);
  assert.equal(result.base_minutes, 4);
  assert.equal(result.raw_minutes, 5.2);
  assert.equal(result.english_minutes, 2);
  assert.equal(result.chinese_minutes, 2);
  assert.equal(result.personal_multiplier, 1.3);
});

test("extracts article content before generic page chrome", () => {
  const html = `
    <html>
      <body>
        <nav>${"navigation ".repeat(200)}</nav>
        <article>${"important ".repeat(100)}</article>
        <footer>${"footer ".repeat(200)}</footer>
      </body>
    </html>
  `;

  assert.equal(extractReadableText(html), "important ".repeat(100).trim());
});

test("extracts a clean title from metadata", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Using Claude Code: The unreasonable effectiveness of HTML | Claude">
        <title>Fallback title</title>
      </head>
    </html>
  `;

  assert.equal(titleFromHtml(html), "Using Claude Code: The unreasonable effectiveness of HTML");
});

test("extracts title from JSON-LD before meta tags", () => {
  const html = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BlogPosting","headline":"JSON-LD title"}
    </script>
    <meta property="og:title" content="Meta title">
  `;

  assert.equal(titleFromHtml(html), "JSON-LD title");
});

test("parses ISO 8601 video durations", () => {
  assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
  assert.equal(parseIsoDuration("PT14M30S"), 870);
});

test("detects YouTube player duration before article text", () => {
  const html = `
    <html>
      <script>
        var ytInitialPlayerResponse = {"videoDetails":{"lengthSeconds":"187"}};
      </script>
      <body><main>${"metadata ".repeat(100)}</main></body>
    </html>
  `;

  assert.deepEqual(detectVideoDuration(html, "https://www.youtube.com/watch?v=test"), {
    source: "youtube_player_response",
    seconds: 187,
  });
});

test("detects JSON-LD video duration", () => {
  const html = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"VideoObject","duration":"PT9M5S"}
    </script>
  `;

  assert.deepEqual(detectVideoDuration(html, "https://example.com/video"), {
    source: "json_ld_video_duration",
    seconds: 545,
  });
});

test("estimates directly from video seconds", () => {
  assert.deepEqual(estimateFromSeconds(187, "test"), {
    estimated_minutes: 5,
    raw_minutes: 4.06,
    base_minutes: 3.12,
    duration_seconds: 187,
    mode: "video_duration",
    personal_multiplier: 1.3,
    source: "test",
  });
});

test("allows overriding the personal multiplier", () => {
  const result = estimateFromText("agent ".repeat(225), { personalMultiplier: 1 });

  assert.equal(result.estimated_minutes, 1);
  assert.equal(result.raw_minutes, 1);
  assert.equal(result.personal_multiplier, 1);
});

test("recognizes X status and article URLs", () => {
  assert.equal(xStatusIdFromUrl("https://x.com/ankrgyl/status/2062635408182427859"), "2062635408182427859");
  assert.equal(xStatusIdFromUrl("https://twitter.com/ankrgyl/status/2062635408182427859?s=20"), "2062635408182427859");
  assert.equal(xArticleIdFromUrl("https://x.com/i/article/2062633861515984896"), "2062633861515984896");
});

test("finds an X article URL in initial tweet state", () => {
  const html = `
    <script>
      window.__INITIAL_STATE__={
        "entities":{
          "tweets":{
            "entities":{
              "2062635408182427859":{
                "entities":{
                  "urls":[{"expanded_url":"http://x.com/i/article/2062633861515984896"}]
                }
              }
            }
          }
        }
      };
    </script>
  `;

  assert.equal(
    xArticleUrlFromInitialState(html, "2062635408182427859"),
    "http://x.com/i/article/2062633861515984896",
  );
});

test("normalizes X article GraphQL payloads", () => {
  const article = xArticleFromTweetResultPayload({
    data: {
      tweetResult: {
        result: {
          article: {
            article_results: {
              result: {
                rest_id: "2062633861515984896",
                title: "How we made continuous trace intelligence possible at scale",
                plain_text: "trace ".repeat(2300),
              },
            },
          },
        },
      },
    },
  });

  assert.equal(article.id, "2062633861515984896");
  assert.equal(article.title, "How we made continuous trace intelligence possible at scale");
  assert.equal(article.source, "x_tweet_article_graphql");
  assert.equal(article.text, "trace ".repeat(2300).trim());
});

test("estimates X article bookmarks from tweet article payloads", async () => {
  const originalFetch = global.fetch;
  const articleText = "trace ".repeat(2300);
  const calls = [];
  global.fetch = async (input) => {
    calls.push(String(input));
    if (String(input).includes("/status/2062635408182427859")) {
      return new Response(`
        <script>
          window.__INITIAL_STATE__={
            "entities":{
              "tweets":{
                "entities":{
                  "2062635408182427859":{
                    "entities":{
                      "urls":[{"expanded_url":"http://x.com/i/article/2062633861515984896"}]
                    }
                  }
                }
              }
            }
          };
        </script>
      `, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (String(input).includes("/guest/activate.json")) {
      return Response.json({ guest_token: "guest-token" });
    }
    if (String(input).includes("/TweetResultByRestId")) {
      return Response.json({
        data: {
          tweetResult: {
            result: {
              article: {
                article_results: {
                  result: {
                    rest_id: "2062633861515984896",
                    title: "How we made continuous trace intelligence possible at scale",
                    plain_text: articleText,
                  },
                },
              },
            },
          },
        },
      });
    }
    throw new Error(`Unexpected fetch: ${input}`);
  };

  try {
    const result = await estimateUrl("https://x.com/ankrgyl/status/2062635408182427859");

    assert.equal(result.title, "How we made continuous trace intelligence possible at scale");
    assert.equal(result.mode, "x_article_text");
    assert.equal(result.final_url, "http://x.com/i/article/2062633861515984896");
    assert.equal(result.estimated_minutes, 15);
    assert.ok(calls.some((call) => call.includes("/TweetResultByRestId")));
  } finally {
    global.fetch = originalFetch;
  }
});
