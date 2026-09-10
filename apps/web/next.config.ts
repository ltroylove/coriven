import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@personal-assistant/types'],

  async redirects() {
    return [
      // C5 route consolidation — Wave 9.1.3
      // permanent: true → 308 (method-preserving permanent redirect)
      { source: '/chat',        destination: '/',                  permanent: true },
      { source: '/today',       destination: '/',                  permanent: true },
      { source: '/approvals',   destination: '/activity',          permanent: true },
      { source: '/memory',      destination: '/settings/memory',   permanent: true },
      { source: '/constraints', destination: '/settings/constraints', permanent: true },
    ]
  },
}

export default nextConfig
