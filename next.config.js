/** @type {import('next').NextConfig} */
const nextConfig = {
  // The site never uses next/image, but Next still serves its image
  // optimizer at /_next/image by default — the endpoint behind several
  // advisories, including a critical remote-code-execution one. Turning
  // optimization off removes that endpoint entirely at no cost.
  images: { unoptimized: true },
}
module.exports = nextConfig
