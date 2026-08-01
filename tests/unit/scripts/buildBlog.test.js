import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  parsePost,
  escapeHtml,
  formatDate,
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
