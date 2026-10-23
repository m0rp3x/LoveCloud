// Behavioral CLI fixture; no browser bundle, Docker or network is used here.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const collector=resolve(process.env.LOVECLOUD_NPM_COLLECTOR_PATH||fileURLToPath(new URL('../scripts/release/collect-npm-licenses.mjs',import.meta.url)));
const root=mkdtempSync(join(tmpdir(),'lovecloud-client-notices-')),source=join(root,'build/node_modules'),runtime=join(root,'runtime/node_modules');
function pkg(base,name,version,extra={}){const directory=join(base,name);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'package.json'),JSON.stringify({name,version,license:'MIT',...extra}));writeFileSync(join(directory,'LICENSE.txt'),'Copyright fixture '+name+' '+version+'\n'+('Retain this notice. '.repeat(25)));return directory;}
pkg(runtime,'server-runtime','1.0.0');pkg(source,'server-runtime','1.0.0');
const client=pkg(source,'client-root','1.0.0',{dependencies:{transitive:'2.0.0'},devDependencies:{'build-only':'1.0.0'},optionalDependencies:{'not-installed':'1.0.0'}});
pkg(source,'build-only','1.0.0');pkg(source,'unused-source-package','1.0.0');pkg(source,'transitive','1.0.0');
const nested=pkg(join(client,'node_modules'),'transitive','2.0.0');
writeFileSync(join(nested,'native.so'),'not a binary: fixture payload');writeFileSync(join(nested,'browser.js'),'fixture payload');
function execute(output,roots){return spawnSync(process.execPath,[collector,'--root',runtime,'--source',source,'--output',output,'--client-roots',roots],{encoding:'utf8'});}
const output=join(root,'notices'),success=execute(output,'client-root');assert.equal(success.status,0,success.stderr);
const inventory=JSON.parse(readFileSync(join(output,'runtime-notice-inventory.json'),'utf8'));
assert.deepEqual(inventory.clientNoticeGraph.packages.map(p=>[p.name,p.version]),[['client-root','1.0.0'],['transitive','2.0.0']]);
assert(existsSync(join(output,'client-root/node_modules/transitive/LICENSE.txt')),'Nested exact-version notice preserved');
assert(!existsSync(join(output,'transitive')),'Unselected hoisted version omitted');assert(!existsSync(join(output,'build-only')),'Development-only dependency omitted');assert(!existsSync(join(output,'unused-source-package')),'Unrelated build-source packages omitted');
assert(!existsSync(join(output,'client-root/node_modules/transitive/native.so')),'No native payload copied');assert(!existsSync(join(output,'client-root/node_modules/transitive/browser.js')),'No executable payload copied');
const missing=execute(join(root,'missing'),'missing-client');assert.notEqual(missing.status,0);assert.match(missing.stderr,/Required client notice dependency is missing/);
const unexpected=execute(join(root,'optimizer'),'sharp');assert.notEqual(unexpected.status,0);assert.match(unexpected.stderr,/Unexpected optimizer\/Next dependency/);
pkg(runtime,'server-runtime','2.0.0');const mismatch=execute(join(root,'mismatch'),'client-root');assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/Runtime\/source version mismatch/);
console.log('PASS client notice CLI: selected production graph, nested exact versions, optional absence, omitted dev/unrelated/executable/native payload, missing required/optimizer/version mismatch fail closed (synthetic fixture).');
