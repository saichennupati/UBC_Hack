/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root so a stray lockfile in a parent folder isn't picked up.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
