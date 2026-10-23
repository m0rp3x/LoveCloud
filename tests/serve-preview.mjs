import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.argv[2]),port=Number(process.argv[3]||33210);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/LoveCloud/'))throw Error('prefix');
    const file=resolve(root,decodeURIComponent(url.pathname.slice('/LoveCloud/'.length))||'index.html');
    if(file!==root&&!file.startsWith(root+sep))throw Error('path');
    if(!(await stat(file)).isFile())throw Error('file');
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Preview QA server ready at /LoveCloud/'));
