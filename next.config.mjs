/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sitecore loads Marketplace apps inside a sandboxed iframe.
  // Allow that framing explicitly instead of the default same-origin policy.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://*.sitecorecloud.io https://xmapps.sitecorecloud.io https://pages.sitecorecloud.io https://portal.sitecorecloud.io https://marketplace-app.sitecorecloud.io",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
