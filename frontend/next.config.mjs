/** @type {import('next').NextConfig} */
const config = {output:'standalone',poweredByHeader:false,experimental:{cpus:1},async rewrites(){const api=process.env.INTERNAL_API_URL;return api?[{source:'/api/v1/:path*',destination:`${api}/api/v1/:path*`},{source:'/hubs/workspace/:path*',destination:`${api}/hubs/workspace/:path*`}]:[];}};
export default config;
