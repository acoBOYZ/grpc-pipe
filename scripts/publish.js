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
const npmTag = process.env.TAG || 'latest'
const branch = process.env.BRANCH || 'main'
const tagName = `v${npmTag.replace(/^v/, '')}`

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
      stdio: 'inherit'
    })

    console.log(`🚀 Publishing ${pkg.name} to npm...`)
    execSync(`bun publish --tag ${npmTag} --access public --no-git-checks`, {
      cwd: packagePath,
      stdio: 'inherit'
    })
  } catch (err) {
    console.error(`❌ Failed to publish ${pkg.name}:`, err.message)
    process.exit(1)
  }
}

try {
  console.log(`🏷️  Creating Git tag: ${tagName}`)
  execSync(`git tag ${tagName}`, { cwd: rootDir, stdio: 'inherit' })
  execSync(`git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' })
  console.log(`✅ Git tag ${tagName} pushed to origin`)
} catch (err) {
  console.error(`❌ Failed to tag or push:`, err.message)
  process.exit(1)
}

console.log('✅ All packages published and Git tagged successfully!')
process.exit(0)