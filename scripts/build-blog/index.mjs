// Build "The Auction Dispatch" — static blog pages rendered into dist/blog/.
//
// Runs as the second half of `npm run build` (vite build && node this-file):
// vite clears and repopulates dist/, then this script layers the blog on top.
// It also works standalone (`node scripts/build-blog/index.mjs`) — it creates
// dist/ if needed and touches nothing outside dist/blog/ except sitemap.xml.
//
// Inputs:
//   content/blog/*.md    — posts with frontmatter (title/description/date/slug/tags/author)
//   content/updates.json — array of {date,title,summary,tags}, newest first
//                          (missing or empty file is fine: the updates page
//                          renders a "no updates yet" note)
//
// Outputs (all URLs directory-style so express.static serves them untouched):
//   dist/blog/index.html, dist/blog/<slug>/index.html, dist/blog/updates/index.html
//   dist/blog/blog.css, dist/blog/rss.xml, dist/sitemap.xml
import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parsePost,
  isValidUpdate,
  renderPostPage,
  renderIndexPage,
  renderUpdatesPage,
  renderSitemap,
  renderRss,
} from './lib.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..', '..')
const contentDir = path.join(rootDir, 'content')
const distDir = path.join(rootDir, 'dist')
const blogDir = path.join(distDir, 'blog')

async function loadPosts() {
  const postsDir = path.join(contentDir, 'blog')
  const files = (await readdir(postsDir)).filter((f) => f.endsWith('.md')).sort()
  const posts = []
  for (const file of files) {
    const src = await readFile(path.join(postsDir, file), 'utf8')
    posts.push(parsePost(src, file))
  }
  // Newest first everywhere (index, RSS). Slug tiebreak keeps output stable.
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
  const slugs = new Set()
  for (const p of posts) {
    if (p.slug === 'updates') throw new Error('Post slug "updates" collides with /blog/updates/')
    if (slugs.has(p.slug)) throw new Error(`Duplicate post slug: ${p.slug}`)
    slugs.add(p.slug)
  }
  return posts
}

// Missing, empty, or malformed updates.json must not break the build — the
// content is preseeded on another branch. Malformed entries are skipped.
async function loadUpdates() {
  let raw
  try {
    raw = await readFile(path.join(contentDir, 'updates.json'), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidUpdate)
  } catch (err) {
    console.warn(`build-blog: could not parse content/updates.json (${err.message}); rendering empty updates page`)
    return []
  }
}

async function main() {
  const posts = await loadPosts()
  const updates = await loadUpdates()

  await mkdir(blogDir, { recursive: true })
  await writeFile(path.join(blogDir, 'index.html'), renderIndexPage(posts))

  for (const post of posts) {
    const dir = path.join(blogDir, post.slug)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'index.html'), renderPostPage(post))
  }

  const updatesDir = path.join(blogDir, 'updates')
  await mkdir(updatesDir, { recursive: true })
  await writeFile(path.join(updatesDir, 'index.html'), renderUpdatesPage(updates))

  await copyFile(path.join(scriptDir, 'blog.css'), path.join(blogDir, 'blog.css'))
  await writeFile(path.join(blogDir, 'rss.xml'), renderRss(posts))
  await writeFile(path.join(distDir, 'sitemap.xml'), renderSitemap(posts, updates[0]?.date))

  console.log(`build-blog: wrote ${posts.length} post(s), index, updates (${updates.length} entr${updates.length === 1 ? 'y' : 'ies'}), rss.xml, sitemap.xml -> ${path.relative(rootDir, blogDir)}/`)
}

main().catch((err) => {
  console.error('build-blog failed:', err)
  process.exit(1)
})
