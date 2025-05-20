// @ts-check

import 'dotenv/config'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Manual list of packages to publish */
const packages = [
  { name: '@grpc-pipe/core', packageDir: 'packages/core' },
  { name: '@grpc-pipe/client', packageDir: 'packages/client' },
  { name: '@grpc-pipe/server', packageDir: 'packages/server' }
]

const rootDir = resolve(__dirname, '..')
const versionTag = process.env.TAG || '0.1.4'
const npmTag = 'latest' // Always point latest to this version
const branch = process.env.BRANCH || 'main'
const tagName = `v${versionTag.replace(/^v/, '')}`

console.log(`🔐 Using TAG=${tagName}, BRANCH=${branch}`)

for (const pkg of packages) {
  const packagePath = resolve(rootDir, pkg.packageDir)

  if (!fs.existsSync(packagePath)) {
    console.warn(`⚠️  Skipping ${pkg.name} — directory not found.`)
    continue
  }

  try {
    console.log(`📦 Building ${pkg.name}...`)
    execSync('bun run build', {
      cwd: packagePath,
      stdio: 'inherit',
    })

    console.log(`🚀 Publishing ${pkg.name}@${versionTag} to npm...`)
    execSync(`bun publish --tag ${npmTag} --access public --no-git-checks`, {
      cwd: packagePath,
      stdio: 'inherit',
    })

    console.log(`🏷️  Updating NPM dist-tag 'latest' for ${pkg.name}`)
    execSync(`npm dist-tag add ${pkg.name}@${versionTag} latest`, {
      cwd: rootDir,
      stdio: 'inherit',
    })

  } catch (err) {
    console.error(`❌ Failed for ${pkg.name}:`, err.message)
    process.exit(1)
  }
}

// Push Git tag
try {
  const tags = execSync('git tag', { cwd: rootDir }).toString().split('\n')
  if (!tags.includes(tagName)) {
    console.log(`🏷️  Creating Git tag: ${tagName}`)
    execSync(`git tag ${tagName}`, { cwd: rootDir, stdio: 'inherit' })

    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd: rootDir,
    }).toString().trim()

    const repoUrlWithToken = remoteUrl.replace(
      /^https:\/\/github\.com\//,
      `https://${process.env.GH_TOKEN}@github.com/`
    )

    console.log(`🚀 Pushing tag ${tagName} to ${repoUrlWithToken}`)

    execSync(`git push "${repoUrlWithToken}" ${tagName}`, {
      cwd: rootDir,
      stdio: 'inherit',
    })

    console.log(`✅ Git tag ${tagName} pushed to origin`)
  } else {
    console.log(`ℹ️ Git tag ${tagName} already exists, skipping tag push`)
  }
} catch (err) {
  console.error(`❌ Failed to tag or push Git tag:`, err.message)
  process.exit(1)
}

console.log('✅ All packages published, dist-tagged, and Git tagged successfully!')
process.exit(0)