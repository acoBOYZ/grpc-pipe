// @ts-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 🔧 Configure your internal packages here
const packages = [
  { name: '@grpc-pipe/core', packageDir: 'packages/core' },
  { name: '@grpc-pipe/client', packageDir: 'packages/client' },
  { name: '@grpc-pipe/server', packageDir: 'packages/server' }
]

const rootDir = path.resolve(__dirname, '..')
const versionTag = process.env.TAG || '0.1.0'
const versionSemver = versionTag.replace(/^v/, '') // e.g. v0.1.0 → 0.1.0

console.log(`🔧 Updating all packages to version: ${versionSemver}`)

function updateDeps(deps) {
  if (!deps) return
  for (const depName of Object.keys(deps)) {
    const isInternal = packages.some(p => p.name === depName)
    if (isInternal) {
      deps[depName] = `^${versionSemver}`
    }
  }
}

for (const pkg of packages) {
  const packagePath = path.resolve(rootDir, pkg.packageDir)
  const packageJsonPath = path.join(packagePath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    console.warn(`⚠️  Skipping ${pkg.name} — package.json not found.`)
    continue
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  // Update the version
  packageJson.version = versionSemver

  // Update internal deps
  updateDeps(packageJson.dependencies)
  updateDeps(packageJson.devDependencies)

  // Save changes
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))
  console.log(`✅ ${pkg.name}: version and internal dependencies updated`)
}

console.log('🎉 All package versions updated successfully!')