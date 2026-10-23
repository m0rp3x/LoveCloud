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
const files=new Map(), packages=[];
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
    if (/^(licen[cs]e|copying|notice|copyright|third[-_]?party)|\.LICENSE(?:\.txt)?$/i.test(entry.name))copy(file,path.relative(source,file));
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
fs.writeFileSync(path.join(output,'runtime-notice-inventory.json'),JSON.stringify({scope:'exact-version runtime package notices recovered from build sources; bundled notices may cover additional upstream modules',packages,files:[...files.values()]},null,2)+'\n');
console.log(`Preserved ${files.size} notices/manifests for ${packages.length} runtime package manifests (no executable/native payload).`);
