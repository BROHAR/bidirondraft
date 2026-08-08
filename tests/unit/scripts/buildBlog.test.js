import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  parsePost,
  escapeHtml,
  formatDate,
  serializeJsonLd,
  isValidUpdate,
  renderPostPage,
  renderIndexPage,
  renderUpdatesPage,
  renderSitemap,
  renderRss,
  SITE_ORIGIN,
} from '../../../scripts/build-blog/lib.mjs'

const SAMPLE_MD = `---
title: Test Post & Title
description: A "test" description.
date: 2026-08-01
slug: test-post
tags: strategy, auction
author: BIDIRON
---

## Heading

Body text with **bold**.
`

describe('parseFrontmatter', () => {
  it('splits attrs from body and parses tags as a list', () => {
    const { attrs, body } = parseFrontmatter(SAMPLE_MD)
    expect(attrs.title).toBe('Test Post & Title')
    expect(attrs.tags).toEqual(['strategy', 'auction'])
    expect(body).toContain('## Heading')
    expect(body).not.toContain('---')
  })

  it('throws when the fence is missing', () => {
    expect(() => parseFrontmatter('no frontmatter here')).toThrow(/frontmatter/)
  })

  it('keeps colons inside values intact', () => {
    const { attrs } = parseFrontmatter('---\ntitle: Auctions: A Love Story\n---\n')
    expect(attrs.title).toBe('Auctions: A Love Story')
  })
})

describe('parsePost', () => {
  it('renders markdown body to HTML', () => {
    const post = parsePost(SAMPLE_MD)
    expect(post.html).toContain('<h2>Heading</h2>')
    expect(post.html).toContain('<strong>bold</strong>')
  })

  it('rejects missing required keys and bad shapes', () => {
    expect(() => parsePost('---\ntitle: X\n---\nbody', 'f.md')).toThrow(/missing frontmatter key/)
    expect(() => parsePost('---\ntitle: X\ndescription: Y\ndate: Aug 1\nslug: x\n---\n', 'f.md')).toThrow(/YYYY-MM-DD/)
    expect(() => parsePost('---\ntitle: X\ndescription: Y\ndate: 2026-08-01\nslug: Bad Slug\n---\n', 'f.md')).toThrow(/kebab/)
  })

  it('rejects oversized frontmatter fields and tag lists', () => {
    const mk = (over) =>
      `---\ntitle: ${over.title ?? 'X'}\ndescription: ${over.description ?? 'Y'}\ndate: 2026-08-01\nslug: x\n${over.tags ? `tags: ${over.tags}\n` : ''}---\nbody`
    expect(() => parsePost(mk({ title: 'a'.repeat(301) }), 'f.md')).toThrow(/"title" exceeds/)
    expect(() => parsePost(mk({ description: 'a'.repeat(501) }), 'f.md')).toThrow(/"description" exceeds/)
    expect(() => parsePost(mk({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(', ') }), 'f.md')).toThrow(/more than 20 tags/)
    expect(() => parsePost(mk({ tags: 'a'.repeat(51) }), 'f.md')).toThrow(/tag exceeds/)
  })

  it('sanitizes raw HTML in the markdown body (script, event handlers, javascript: links)', () => {
    const post = parsePost(`---
title: X
description: Y
date: 2026-08-01
slug: x
---

Intro paragraph.

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')">

[click me](javascript:alert('xss')) and [a real link](https://example.com/).
`)
    expect(post.html).not.toContain('<script')
    expect(post.html).not.toContain('onerror')
    expect(post.html).not.toContain('javascript:')
    expect(post.html).toContain('Intro paragraph.')
    // Legitimate markup survives.
    expect(post.html).toContain('<a href="https://example.com/">a real link</a>')
    expect(post.html).toContain('<img src="x">')
  })

  it('keeps legitimate markdown constructs through sanitization', () => {
    const post = parsePost(`---
title: X
description: Y
date: 2026-08-01
slug: x
---

## Heading

Some \`inline code\` and **bold**.

\`\`\`js
const a = 1
\`\`\`

| Col A | Col B |
| ----- | ----- |
| 1     | 2     |

![alt text](/img.png)
`)
    expect(post.html).toContain('<h2>Heading</h2>')
    expect(post.html).toContain('<code>inline code</code>')
    expect(post.html).toContain('<pre>')
    expect(post.html).toContain('<table>')
    expect(post.html).toContain('<img src="/img.png" alt="alt text">')
  })
})

describe('rendered pages', () => {
  const post = parsePost(SAMPLE_MD)

  it('post page carries full SEO head: title, description, canonical, OG, JSON-LD', () => {
    const html = renderPostPage(post)
    expect(html).toContain('<title>Test Post &amp; Title — The Auction Dispatch</title>')
    expect(html).toContain('<meta name="description" content="A &quot;test&quot; description.">')
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/blog/test-post/">`)
    expect(html).toContain('<meta property="og:type" content="article">')
    expect(html).toContain('"@type":"BlogPosting"')
    expect(html).toContain('<time datetime="2026-08-01">')
    // Exactly one h1 (the article title; masthead demotes to <p>)
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
  })

  it('post page includes the newsletter form wired to /api/subscribe with honeypot', () => {
    const html = renderPostPage(post)
    expect(html).toContain("fetch('/api/subscribe'")
    expect(html).toContain("source: 'blog'")
    expect(html).toContain('name="website"')
  })

  it('every page carries the gtag snippet and gtag-guarded signup events', () => {
    for (const html of [renderPostPage(post), renderIndexPage([post]), renderUpdatesPage([])]) {
      expect(html).toContain('googletagmanager.com/gtag/js?id=G-0Q8T4CC9DE')
      expect(html).toContain("gtag('config', 'G-0Q8T4CC9DE')")
      // Signup analytics stay no-op-safe when the tag is blocked.
      expect(html).toContain("typeof window.gtag === 'function'")
      expect(html).toContain("'event', 'email_signup'")
    }
  })

  it('index page lists posts, links them, and uses Blog JSON-LD with a single h1', () => {
    const html = renderIndexPage([post])
    expect(html).toContain('href="/blog/test-post/"')
    expect(html).toContain('"@type":"Blog"')
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/blog/">`)
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
  })

  it('updates page renders entries when present and a note when empty', () => {
    const filled = renderUpdatesPage([
      { date: '2026-08-01', title: 'Launched', summary: 'Blog is live.', tags: ['site'] },
    ])
    expect(filled).toContain('Launched')
    expect(filled).toContain('<time datetime="2026-08-01">')
    expect(filled).toContain('"@type":"CollectionPage"')

    const empty = renderUpdatesPage([])
    expect(empty).toContain('No updates yet')
    expect(empty.match(/<h1[\s>]/g)).toHaveLength(1)
  })
})

describe('XSS hardening', () => {
  const HOSTILE_MD = `---
title: Sneaky</script><script>alert('xss')</script>
description: Also "sneaky" & <bad>.
date: 2026-08-01
slug: sneaky
tags: <evil>, ok
---

Body.
`

  it('a </script> in the title cannot break out of the JSON-LD block', () => {
    const post = parsePost(HOSTILE_MD)
    for (const html of [renderPostPage(post), renderIndexPage([post])]) {
      const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
      expect(jsonLd).not.toContain('<')
      expect(jsonLd).not.toContain('>')
      expect(jsonLd).not.toContain('&')
      // Round-trips: the escapes are plain \uXXXX inside JSON strings.
      const parsed = JSON.parse(jsonLd)
      const headline = parsed['@type'] === 'Blog' ? parsed.blogPost[0].headline : parsed.headline
      expect(headline).toBe("Sneaky</script><script>alert('xss')</script>")
    }
  })

  it('serializeJsonLd escapes angle brackets and ampersands without corrupting values', () => {
    const out = serializeJsonLd({ t: '</script> & <b>' })
    expect(out).toBe('{"t":"\\u003c/script\\u003e \\u0026 \\u003cb\\u003e"}')
    expect(JSON.parse(out)).toEqual({ t: '</script> & <b>' })
  })

  it('updates page escapes the datetime attribute', () => {
    const html = renderUpdatesPage([
      { date: '2026-08-01', title: 'T', summary: 'S', tags: [] },
    ])
    expect(html).toContain('<time datetime="2026-08-01">')
    const hostile = renderUpdatesPage([
      { date: '2026-08-01"><script>alert(1)</script>', title: 'T', summary: 'S', tags: [] },
    ])
    expect(hostile).not.toContain('"><script>alert(1)</script>')
  })

  it('isValidUpdate rejects malformed dates and accepts strict YYYY-MM-DD', () => {
    expect(isValidUpdate({ date: '2026-08-01', title: 'T' })).toBe(true)
    expect(isValidUpdate({ date: 'Aug 1, 2026', title: 'T' })).toBe(false)
    expect(isValidUpdate({ date: '2026-08-01"><script>', title: 'T' })).toBe(false)
    expect(isValidUpdate({ date: '2026-8-1', title: 'T' })).toBe(false)
    expect(isValidUpdate({ title: 'T' })).toBe(false)
    expect(isValidUpdate(null)).toBe(false)
  })

  it('sitemap escapes lastmod', () => {
    const post = parsePost(SAMPLE_MD)
    const xml = renderSitemap([post], '2026-08-01<script>')
    expect(xml).not.toContain('<script>')
    expect(xml).toContain('<lastmod>2026-08-01&lt;script&gt;</lastmod>')
  })
})

describe('feeds', () => {
  const post = parsePost(SAMPLE_MD)

  it('sitemap covers root, blog index, updates, and each post', () => {
    const xml = renderSitemap([post], '2026-08-01')
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/blog/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/blog/updates/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/blog/test-post/</loc>`)
    expect(xml).toContain('<lastmod>2026-08-01</lastmod>')
  })

  it('rss escapes entities and stamps RFC-822 dates', () => {
    const xml = renderRss([post])
    expect(xml).toContain('<title>Test Post &amp; Title</title>')
    expect(xml).toContain(`<guid isPermaLink="true">${SITE_ORIGIN}/blog/test-post/</guid>`)
    expect(xml).toContain('<pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate>')
  })
})

describe('utilities', () => {
  it('escapeHtml covers the five entities', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })

  it('formatDate is UTC-pinned', () => {
    expect(formatDate('2026-08-01')).toBe('August 1, 2026')
  })
})
