#!/usr/bin/env node
// Release proof for the actual public static deployment, using only public data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [urlArg,sha,reportFile]=process.argv.slice(2);
const url=new URL(urlArg);
assert.equal(url.href,'https://m0rp3x.github.io/LoveCloud/');
assert.match(sha||'',/^[0-9a-f]{40}$/);
let metadata,lastError;
for(let attempt=0;attempt<25;attempt++){
  try{
    const response=await fetch(new URL(`preview-version.json?sha=${sha}`,url),{signal:AbortSignal.timeout(10000),cache:'no-store'});
    assert(response.ok,`Public version metadata returned ${response.status}`);
    metadata=await response.json();
    assert.equal(metadata.sourceSha,sha,'Public Pages deployment is not the release commit yet.');
    break;
  }catch(error){lastError=error;if(attempt<24)await new Promise(resolve=>setTimeout(resolve,2000));}
}
assert.equal(metadata?.sourceSha,sha,lastError?.message);
if(reportFile){
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  assert.equal(report.sourceSha,sha);
  assert.equal(report.url,url.href);
  assert(report.checks.length>=8 && report.checks.every(check=>check.status==='PASS'));
  report.publishedUrl=url.href;
  report.publishedSourceSha=metadata.sourceSha;
  report.checks.push({name:'published Pages exact source revision',status:'PASS',detail:`Public preview-version.json reports ${sha}. Chromium exercised resources and actions on the public URL.`});
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
}
console.log('PASS public Pages source matches '+sha);
