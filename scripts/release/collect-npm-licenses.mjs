#!/usr/bin/env node
// Preserve notices before Next standalone tracing drops non-executable files.
// Runtime package inventory selects an exact-version source package so omitted
// LICENSE files can be recovered without shipping optional native/build deps.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
if (!args['--root'] || !args['--source'] || !args['--output']) throw new Error('Usage: collect-npm-licenses.mjs --root RUNTIME_NODE_MODULES --source BUILD_NODE_MODULES --output EMPTY_OUTPUT');
const runtime=path.resolve(args['--root']), source=path.resolve(args['--source']), output=path.resolve(args['--output']);
fs.mkdirSync(output, {recursive:true});
if (fs.readdirSync(output).length) throw new Error('Notice output must be empty.');
const files=new Map(), packages=[], clientPackages=[], clientVisited=new Set();
function copy(file,relative) {
  const destination=path.join(output,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(file,destination);
  files.set(relative.split(path.sep).join('/'),{path:relative.split(path.sep).join('/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}
function notices(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {if(entry.name!=='node_modules')notices(file);continue;}
    if (!entry.isFile()) continue;
    if (/^(licen[cs]e|copying|notice|copyright|third[-_]?party)|\.(?:LICENSE|LEGAL)(?:\.txt)?$/i.test(entry.name))copy(file,path.relative(source,file));
  }
}
function visit(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()){visit(file);continue;}
    if(!entry.isFile() || entry.name!=='package.json')continue;
    const relative=path.relative(runtime,file);
    const actual=JSON.parse(fs.readFileSync(file,'utf8'));
    const upstream=path.join(source,relative);
    if(!fs.existsSync(upstream))throw new Error(`Runtime package has no build-source manifest: ${relative}`);
    const original=JSON.parse(fs.readFileSync(upstream,'utf8'));
    if(actual.name!==original.name || actual.version!==original.version)throw new Error(`Runtime/source version mismatch: ${relative}`);
    packages.push({path:relative.split(path.sep).join('/'),name:actual.name,version:actual.version,license:original.license});
    copy(upstream,relative);
    notices(path.dirname(upstream));
  }
}
visit(runtime);
if(!packages.length)throw new Error('No runtime packages found.');
function resolveClient(name,from,required) {
  // Follow npm's installed resolution without relying on package.json exports.
  let directory=from;
  while(directory.startsWith(path.dirname(source)+path.sep) || directory===path.dirname(source)){
    const candidate=path.join(directory,'node_modules',name,'package.json');
    if(fs.existsSync(candidate) && candidate.startsWith(source+path.sep))return candidate;
    const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
  const hoisted=path.join(source,name,'package.json');
  if(fs.existsSync(hoisted))return hoisted;
  if(required)throw new Error(`Required client notice dependency is missing: ${name}`);
  return null;
}
function clientGraph(name,from,required=true){
  // The server collector covers Next's vendored notices. The disabled sharp
  // optimizer is not part of any deliberately selected client graph.
  if(name==='next' || name==='sharp' || name.startsWith('@img/'))throw new Error(`Unexpected optimizer/Next dependency in selected client graph: ${name}`);
  const manifest=resolveClient(name,from,required);
  if(!manifest || clientVisited.has(manifest))return;
  clientVisited.add(manifest);
  const data=JSON.parse(fs.readFileSync(manifest,'utf8'));
  clientPackages.push({path:path.relative(source,manifest).split(path.sep).join('/'),name:data.name,version:data.version,license:data.license});
  copy(manifest,path.relative(source,manifest));
  notices(path.dirname(manifest));
  const directory=path.dirname(manifest);
  for(const dependency of Object.keys(data.dependencies||{}))clientGraph(dependency,directory,true);
  for(const dependency of Object.keys(data.optionalDependencies||{}))clientGraph(dependency,directory,false);
  for(const dependency of Object.keys(data.peerDependencies||{}))clientGraph(dependency,directory,false);
}
const clientRoots=(args['--client-roots']||'').split(',').filter(Boolean);
for(const name of clientRoots)clientGraph(name,path.dirname(source));
fs.writeFileSync(path.join(output,'runtime-notice-inventory.json'),JSON.stringify({scope:'exact-version server runtime package notices recovered from build sources; bundled notices may cover additional upstream modules',packages,clientNoticeGraph:{scope:'notices-only superset of selected browser production graphs; not an actual binary inventory or SBOM',roots:clientRoots,packages:clientPackages},files:[...files.values()]},null,2)+'\n');
console.log(`Preserved ${files.size} notices/manifests for ${packages.length} server runtime and ${clientPackages.length} client-graph manifests (no executable/native payload).`);
