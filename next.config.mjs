/** @type {import('next').NextConfig} */

// En-têtes de sécurité communs. La Content-Security-Policy est posée par middleware.ts (nonce par requête).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // geolocation=(self) : boutons « Ma position » (recherche DENUE, Carte)
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig = {
  poweredByHeader: false,
  // better-sqlite3 est un module natif : on ne le bundle pas.
  serverExternalPackages: ["better-sqlite3", "exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
