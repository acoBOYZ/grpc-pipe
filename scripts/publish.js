// @ts-check

import 'dotenv/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publish } from '@tanstack/config/publish'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

await publish({
  packages: [
    { name: '@grpc-pipe/core', packageDir: 'packages/core' },
    { name: '@grpc-pipe/client', packageDir: 'packages/client' },
    { name: '@grpc-pipe/server', packageDir: 'packages/server' }
  ],
  branchConfigs: {
    main: {
      prerelease: false,
    },
    alpha: {
      prerelease: true,
    },
    beta: {
      prerelease: true,
    },
  },
  rootDir: resolve(__dirname, '..'),
  branch: process.env.BRANCH ?? 'main',
  tag: process.env.TAG ?? 'v0.1.0',
  ghToken: process.env.GH_TOKEN ?? '',
})

process.exit(0)