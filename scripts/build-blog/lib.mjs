// Pure rendering/parsing helpers for the blog build. No filesystem access —
// everything here takes strings/objects in and returns strings out, so it is
// unit-testable (tests/unit/scripts/buildBlog.test.js) and the orchestrator
// (index.mjs) stays a thin I/O shell.
import { marked } from 'marked'
import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

// marked 18.x has no sanitize option: raw HTML (and javascript: hrefs) in the
// markdown source pass through verbatim. Post sources are ours, but the build
// must not be a stored-XSS vector, so every parsed body goes through DOMPurify
// (jsdom-backed — this runs in Node, not a browser). Defaults keep normal
// markup (headings, links, images, code, tables) and strip scripts, event
// handlers, and javascript: URLs.
const purify = createDOMPurify(new JSDOM('').window)

export const SITE_ORIGIN = 'https://www.bidirondraft.com'
// Same GA4 property the app loads in index.html — blog pageviews land in the
// same stream. The stub gtag() exists even when the tag script is blocked, so
// inline event calls below stay safe no-ops.
export const GA_MEASUREMENT_ID = 'G-0Q8T4CC9DE'
const GA_SNIPPET = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_MEASUREMENT_ID}');
  </script>`
export const BLOG_TITLE = 'The Auction Dispatch'
export const BLOG_TAGLINE =
  'Fantasy football auction draft strategy from BIDIRON — value hunting, nomination tactics, and budget pacing, backed by thousands of simulated drafts.'

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

// Minimal frontmatter: a leading `---` fence, `key: value` lines, closing
// `---`. Tags are comma-separated. Deliberately not YAML — no nesting, no
// quoting rules — because the posts are ours and simple beats clever.
export function parseFrontmatter(src) {
  const normalized = src.replace(/^﻿/, '')
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    throw new Error('Missing frontmatter block (expected leading "---" fence)')
  }
  const attrs = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx === -1) throw new Error(`Bad frontmatter line (no "key: value"): ${line}`)
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    attrs[key] = key === 'tags'
      ? value.split(',').map((t) => t.trim()).filter(Boolean)
      : value
  }
  return { attrs, body: normalized.slice(match[0].length) }
}

const REQUIRED_KEYS = ['title', 'description', 'date', 'slug']

// Sanity caps on frontmatter scalars — a title should never be a novel, and
// oversized values are a sign the file is malformed (or hostile).
const MAX_FIELD_LENGTHS = { title: 300, description: 500, author: 100 }
const MAX_TAG_LENGTH = 50
const MAX_TAGS = 20

export function parsePost(src, filename = 'post') {
  const { attrs, body } = parseFrontmatter(src)
  for (const key of REQUIRED_KEYS) {
    if (!attrs[key]) throw new Error(`${filename}: missing frontmatter key "${key}"`)
  }
  for (const [key, max] of Object.entries(MAX_FIELD_LENGTHS)) {
    if (attrs[key] && attrs[key].length > max) {
      throw new Error(`${filename}: frontmatter "${key}" exceeds ${max} characters`)
    }
  }
  const tags = attrs.tags ?? []
  if (tags.length > MAX_TAGS) {
    throw new Error(`${filename}: more than ${MAX_TAGS} tags`)
  }
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) {
    throw new Error(`${filename}: tag exceeds ${MAX_TAG_LENGTH} characters`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attrs.date)) {
    throw new Error(`${filename}: date must be YYYY-MM-DD, got "${attrs.date}"`)
  }
  if (!/^[a-z0-9-]+$/.test(attrs.slug)) {
    throw new Error(`${filename}: slug must be lowercase-kebab, got "${attrs.slug}"`)
  }
  return {
    title: attrs.title,
    description: attrs.description,
    date: attrs.date,
    slug: attrs.slug,
    tags,
    author: attrs.author ?? 'BIDIRON',
    html: purify.sanitize(marked.parse(body)),
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// XML text nodes need the same five entities; alias for intent at call sites.
export const escapeXml = escapeHtml

// Serialize JSON-LD for embedding inside a <script> block. JSON.stringify
// does not escape < or >, so a value containing "</script>" would terminate
// the script element and inject live markup. Escaping & as well prevents any
// entity-based reinterpretation. & goes first so it can't touch the \u00XX
// sequences the later replacements introduce (they contain no & anyway, but
// the ordering makes that a non-issue by construction).
export function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
}

// Entry filter for content/updates.json (used by index.mjs's loader). Date is
// strict YYYY-MM-DD — mirroring parsePost's frontmatter rule — because it is
// interpolated into <time datetime> and fed to formatDate, so a malformed
// value is both a rendering bug and a markup-injection vector.
export function isValidUpdate(u) {
  return Boolean(
    u &&
    typeof u.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(u.date) &&
    typeof u.title === 'string'
  )
}

// '2026-08-01' -> 'August 1, 2026' (UTC-pinned so the build machine's zone
// can't shift the calendar day).
export function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function rfc822(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).toUTCString()
}

// ---------------------------------------------------------------------------
// Shared page chrome
// ---------------------------------------------------------------------------

// `siteNameTag`: the masthead wordmark is the index page's h1; on every other
// page the h1 belongs to the article, so the wordmark demotes to a <p>.
function masthead({ isIndex }) {
  const Tag = isIndex ? 'h1' : 'p'
  return `<header class="masthead">
  <p class="masthead-brand"><a href="/">BIDIRON</a></p>
  <${Tag} class="masthead-title"><a href="/blog/">${escapeHtml(BLOG_TITLE)}</a></${Tag}>
  <nav class="masthead-nav" aria-label="Blog">
    <a href="/blog/">Posts</a>
    <a href="/blog/updates/">Updates</a>
    <a href="/">Launch the Simulator</a>
  </nav>
</header>`
}

// Static-page twin of src/components/EmailSignupForm.jsx: same /api/subscribe
// contract (email + source + `website` honeypot), same UX copy, vanilla JS.
function signupSection() {
  return `<section class="signup" aria-labelledby="signup-heading">
  <h2 id="signup-heading">News &amp; Updates</h2>
  <p class="signup-blurb">New Dispatch posts and simulator updates, straight to your inbox.</p>
  <form id="signup-form" novalidate>
    <label class="visually-hidden" for="signup-email">Email address</label>
    <input id="signup-email" type="email" placeholder="you@example.com" maxlength="254" autocomplete="email" required>
    <input type="text" name="website" class="signup-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" id="signup-submit">Subscribe</button>
  </form>
  <p id="signup-status" role="status" aria-live="polite"></p>
</section>
<script>
(function () {
  var form = document.getElementById('signup-form')
  var input = document.getElementById('signup-email')
  var hp = form.querySelector('.signup-hp')
  var button = document.getElementById('signup-submit')
  var status = document.getElementById('signup-status')
  var EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/
  var done = false
  // GA4 signup event; safe no-op when gtag is blocked or unavailable.
  function trackSignup(outcome) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'email_signup', { source: 'blog', outcome: outcome })
      }
    } catch (err) { /* analytics must never break the form */ }
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault()
    if (done || button.disabled) return
    var email = input.value.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      status.textContent = 'ENTER A VALID EMAIL ADDRESS'
      status.className = 'is-error'
      trackSignup('invalid')
      return
    }
    button.disabled = true
    button.textContent = 'SENDING\\u2026'
    status.textContent = ''
    status.className = ''
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, source: 'blog', website: hp.value || '' })
    }).then(function (res) {
      return res.json().catch(function () { return null }).then(function (body) {
        if (!res.ok || !body || !body.ok) {
          throw new Error(body && body.error ? body.error : '')
        }
        done = true
        form.hidden = true
        status.textContent = 'SIGNED UP \\u2014 WE\\u2019LL BE IN TOUCH'
        status.className = 'is-success'
        trackSignup('success')
      })
    }).catch(function (err) {
      button.disabled = false
      button.textContent = 'Subscribe'
      status.textContent = (err && err.message ? err.message : "COULDN'T SIGN UP \\u2014 TRY AGAIN LATER").toUpperCase()
      status.className = 'is-error'
      trackSignup('error')
    })
  })
})()
</script>`
}

function footer() {
  const year = new Date().getFullYear()
  return `<footer class="site-footer">
  <p><a href="/">BIDIRON</a> — the fantasy football auction draft simulator. Free, in your browser.</p>
  <p>&copy; ${year} BIDIRON &middot; <a href="/blog/rss.xml">RSS</a></p>
</footer>`
}

// Full document shell. Every blog page flows through this so head metadata
// stays consistent: title/description/canonical, OG + Twitter cards (same
// pattern as the app's index.html), RSS alternate, and page-provided JSON-LD.
export function pageShell({ title, description, canonicalPath, jsonLd, main, isIndex = false, ogType = 'website' }) {
  const canonical = `${SITE_ORIGIN}${canonicalPath}`
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(BLOG_TITLE)}" href="/blog/rss.xml">
  <link rel="stylesheet" href="/blog/blog.css">

${GA_SNIPPET}

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="BIDIRON">
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="BIDIRON — Fantasy Football Auction Draft Simulator">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${SITE_ORIGIN}/og-image.png">

  <script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>
</head>
<body>
${masthead({ isIndex })}
<main>
${main}
${signupSection()}
</main>
${footer()}
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function renderPostPage(post) {
  const path = `/blog/${post.slug}/`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    url: `${SITE_ORIGIN}${path}`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_ORIGIN}${path}` },
    image: `${SITE_ORIGIN}/og-image.png`,
    author: { '@type': 'Organization', name: post.author, url: SITE_ORIGIN },
    publisher: { '@type': 'Organization', name: 'BIDIRON', url: SITE_ORIGIN },
    keywords: post.tags.join(', '),
    isPartOf: { '@type': 'Blog', name: BLOG_TITLE, url: `${SITE_ORIGIN}/blog/` },
  }
  const main = `<article class="post">
  <header class="post-header">
    <h1>${escapeHtml(post.title)}</h1>
    <p class="post-meta">
      <time datetime="${post.date}">${formatDate(post.date)}</time>
      <span class="post-author">by ${escapeHtml(post.author)}</span>
    </p>
    ${post.tags.length ? `<ul class="tag-list">${post.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
  </header>
  <div class="post-body">
${post.html}
  </div>
  <nav class="post-footer-nav" aria-label="More from the Dispatch">
    <a href="/blog/">&larr; All posts</a>
    <a href="/">Run a practice auction &rarr;</a>
  </nav>
</article>`
  return pageShell({
    title: `${post.title} — ${BLOG_TITLE}`,
    description: post.description,
    canonicalPath: path,
    jsonLd,
    main,
    ogType: 'article',
  })
}

export function renderIndexPage(posts) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: BLOG_TITLE,
    description: BLOG_TAGLINE,
    url: `${SITE_ORIGIN}/blog/`,
    publisher: { '@type': 'Organization', name: 'BIDIRON', url: SITE_ORIGIN },
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      datePublished: p.date,
      url: `${SITE_ORIGIN}/blog/${p.slug}/`,
    })),
  }
  const items = posts.map((p) => `    <li>
      <article class="post-card">
        <h2><a href="/blog/${p.slug}/">${escapeHtml(p.title)}</a></h2>
        <p class="post-meta"><time datetime="${p.date}">${formatDate(p.date)}</time></p>
        <p>${escapeHtml(p.description)}</p>
      </article>
    </li>`).join('\n')
  const main = `<section class="post-list" aria-label="Posts">
  <p class="blog-tagline">${escapeHtml(BLOG_TAGLINE)}</p>
  <ul>
${items}
  </ul>
</section>`
  return pageShell({
    title: `${BLOG_TITLE} — Fantasy Football Auction Draft Strategy | BIDIRON`,
    description: BLOG_TAGLINE,
    canonicalPath: '/blog/',
    jsonLd,
    main,
    isIndex: true,
  })
}

// Tolerates updates == [] (another branch preseeds content/updates.json; a
// missing/empty file must not break the build — see index.mjs loader).
export function renderUpdatesPage(updates) {
  const description =
    'Recent updates to BIDIRON, the fantasy football auction draft simulator: new features, AI strategy tuning, and data refreshes.'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Recent Updates — BIDIRON',
    description,
    url: `${SITE_ORIGIN}/blog/updates/`,
    isPartOf: { '@type': 'Blog', name: BLOG_TITLE, url: `${SITE_ORIGIN}/blog/` },
    publisher: { '@type': 'Organization', name: 'BIDIRON', url: SITE_ORIGIN },
  }
  const body = updates.length
    ? `<ul class="update-list">
${updates.map((u) => `    <li>
      <article class="update">
        <h2>${escapeHtml(u.title)}</h2>
        <p class="post-meta"><time datetime="${escapeHtml(u.date)}">${formatDate(u.date)}</time></p>
        <p>${escapeHtml(u.summary)}</p>
        ${Array.isArray(u.tags) && u.tags.length ? `<ul class="tag-list">${u.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      </article>
    </li>`).join('\n')}
  </ul>`
    : '<p class="no-updates">No updates yet — check back soon.</p>'
  const main = `<article class="post">
  <header class="post-header">
    <h1>Recent Updates</h1>
    <p class="blog-tagline">What&rsquo;s new in the simulator, newest first.</p>
  </header>
${body}
</article>`
  return pageShell({
    title: `Recent Updates — ${BLOG_TITLE} | BIDIRON`,
    description,
    canonicalPath: '/blog/updates/',
    jsonLd,
    main,
  })
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export function renderSitemap(posts, updatesLastmod) {
  const latestPost = posts.map((p) => p.date).sort().at(-1)
  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: latestPost },
    { loc: `${SITE_ORIGIN}/blog/`, lastmod: latestPost },
    { loc: `${SITE_ORIGIN}/blog/updates/`, lastmod: updatesLastmod ?? latestPost },
    ...posts.map((p) => ({ loc: `${SITE_ORIGIN}/blog/${p.slug}/`, lastmod: p.date })),
  ]
  const entries = urls.map((u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `
    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}
  </url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`
}

export function renderRss(posts) {
  const items = posts.map((p) => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${SITE_ORIGIN}/blog/${p.slug}/</link>
      <guid isPermaLink="true">${SITE_ORIGIN}/blog/${p.slug}/</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${escapeXml(p.description)}</description>
    </item>`).join('\n')
  const lastBuild = posts.length ? rfc822(posts[0].date) : new Date().toUTCString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(BLOG_TITLE)}</title>
    <link>${SITE_ORIGIN}/blog/</link>
    <description>${escapeXml(BLOG_TAGLINE)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${SITE_ORIGIN}/blog/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`
}
