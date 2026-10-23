/** @type {import('next').NextConfig} */
// Original files are served by the authenticated API; no Next image optimizer.
const config = {output:'standalone',images:{unoptimized:true},outputFileTracingExcludes:{'/*':['node_modules/sharp/**/*','node_modules/@img/**/*']},poweredByHeader:false,experimental:{cpus:1},async rewrites(){const api=process.env.INTERNAL_API_URL;return api?[{source:'/api/v1/:path*',destination:`${api}/api/v1/:path*`},{source:'/hubs/workspace/:path*',destination:`${api}/hubs/workspace/:path*`}]:[];}};
export default config;
