#!/usr/bin/env node
// Green CI is not a deploy. After `wrangler deploy`, wait until the live site
// serves /version.json with the commit that was just built, or fail the job.
// DevHub kit/: edit there, sync from the Kit tab.
//
//   node scripts/verify-deploy.mjs https://example.marcportal.com
//   (expects GITHUB_SHA, which GitHub Actions sets; or pass a sha second)

const [base, expectedArg] = process.argv.slice(2)
const expected = (expectedArg ?? process.env.GITHUB_SHA ?? '').toLowerCase()
if (!base || !expected) {
  console.error('usage: verify-deploy.mjs <site url> [sha]   (or set GITHUB_SHA)')
  process.exit(2)
}

const deadline = Date.now() + 5 * 60_000
let last = 'no answer yet'
let blocked = 0
while (Date.now() < deadline) {
  try {
    const res = await fetch(new URL(`/version.json?t=${Date.now()}`, base), { headers: { 'cache-control': 'no-cache' } })
    const text = await res.text()
    if (res.ok && text.trim().startsWith('{')) {
      const sha = String(JSON.parse(text).sha ?? '').toLowerCase()
      if (sha && (sha.startsWith(expected) || expected.startsWith(sha))) {
        console.log(`✔ ${base} serves ${expected.slice(0, 7)}`)
        process.exit(0)
      }
      last = `serves ${sha.slice(0, 7) || '?'}, expected ${expected.slice(0, 7)}`
    } else if (res.status === 403 || (res.status === 503 && res.headers.get('cf-mitigated'))) {
      // Cloudflare bot protection blocks datacenter IPs (GitHub's runners)
      // on some sites. The deploy itself succeeded; this runner just can't
      // look. DevHub checks the live sha from the PC instead.
      if (++blocked >= 3) {
        console.log(`⚠ ${base} blocks this runner (HTTP ${res.status}, bot protection); not verified from here. DevHub's "live" light checks it.`)
        process.exit(0)
      }
      last = `GET /version.json → ${res.status} (bot protection?)`
    } else {
      last = `GET /version.json → ${res.status}${res.ok ? ' (not JSON: SPA fallback?)' : ''}`
    }
  } catch (e) {
    last = e instanceof Error ? e.message : String(e)
  }
  await new Promise((r) => setTimeout(r, 10_000))
}
console.error(`✘ ${base} never served the new build: ${last}`)
process.exit(1)
