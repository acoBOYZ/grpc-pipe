// @ts-check

import 'dotenv/config'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { packages } from './_packages'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const rootDir = resolve(__dirname, '..')
const versionTag = process.env.TAG || '0.1.0'
const npmTag = 'latest' // Always point latest to this version
const branch = process.env.BRANCH || 'main'
const tagName = `v${versionTag.replace(/^v/, '')}`
const npmignorePath = resolve(rootDir, '.npmignore')

console.log(`🔐 Using TAG=${tagName}, BRANCH=${branch}`)

for (const pkg of packages) {
  const targetIgnorePath = resolve(rootDir, pkg.packageDir, '.npmignore')
  fs.copyFileSync(npmignorePath, targetIgnorePath)
  console.log(`📄 Copied .npmignore to ${pkg.name}`)

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

    execSync('git add .', { cwd: rootDir });
    execSync(`git commit -m "chore: release v${versionTag}"`, {
      cwd: rootDir,
      stdio: 'inherit',
    });

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