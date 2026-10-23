import {resolve,join} from 'node:path';
import {existsSync} from 'node:fs';
import {scratch,projectName,copySourceInstall,install,checkLocked,ready,integration,onboarding,clean} from './compose-harness.mjs';
const suite=process.argv[2],images=resolve(process.argv[3]||process.env.LOVECLOUD_TEST_IMAGES||'compose.images.yaml');
if(!['integration','onboarding'].includes(suite)||!existsSync(images))throw new Error('Usage: node tests/run-suite.mjs integration|onboarding PATH_TO_DIGEST_LOCK [--keep-running]');
const root=join(scratch(),suite);
copySourceInstall(root,images);
try{const url=install(root,{port:suite==='integration'?3212:3213,project:projectName(suite),mode:process.platform==='win32'?'pwsh':'sh'});checkLocked(root);await ready(url);await(suite==='integration'?integration:onboarding)(root,url);console.log('PASS isolated '+suite+' using candidate digest lock.');}
finally{if(!process.argv.includes('--keep-running'))clean(root);}
