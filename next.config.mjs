/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 est un module natif : on ne le bundle pas.
  serverExternalPackages: ["better-sqlite3", "exceljs"],
};
export default nextConfig;
