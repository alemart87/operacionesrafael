/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Next hace de proxy hacia el backend FastAPI: el navegador habla con un
  // solo origen (sin CORS) y en Docker el backend queda en 127.0.0.1:8000.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: process.env.BACKEND_URL
          ? `${process.env.BACKEND_URL}/api/:path*`
          : "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
