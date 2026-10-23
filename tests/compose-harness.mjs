import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,cpSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

export const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function run(command,args=[],{cwd=sourceRoot,env={},capture=false,allowFailure=false}={}) {
  const result=spawnSync(command,args,{cwd,env:{...process.env,...env},encoding:'utf8',stdio:capture?'pipe':'inherit',timeout:900000});
  if((result.error||result.status!==0)&&!allowFailure)throw new Error(`${command} ${args.slice(0,2).join(' ')} failed (${result.status??result.error?.code}).`);
  return capture?(result.stdout||'').trim():result.status;
}
export function scratch(){mkdirSync(join(sourceRoot,'.artifacts'),{recursive:true});return mkdtempSync(join(sourceRoot,'.artifacts','lc000-verify-'));}
export function projectName(kind){return `lc000-${kind}-${randomBytes(4).toString('hex')}`;}
export function compose(root,args,options={}){return run('docker',['compose',...args],{cwd:root,...options,env:{COMPOSE_PROJECT_NAME:undefined,COMPOSE_FILE:undefined,COMPOSE_PATH_SEPARATOR:undefined,APP_ORIGIN:undefined,SECURE_COOKIES:undefined,LOVE_CLOUD_PORT:undefined,LOVE_CLOUD_BIND:undefined,...options.env}});}
export function jsonConfig(root){return JSON.parse(compose(root,['config','--format','json'],{capture:true}));}
export async function ready(url){for(let n=0;n<120;n++){try{if((await fetch(url+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw new Error('Application readiness timeout.');}
export function test(root,url,name){run(process.execPath,[join(sourceRoot,'tests',name+'.mjs')],{env:{LOVECLOUD_TEST_ROOT:root,LOVECLOUD_TEST_URL:url,LOVECLOUD_TEST_ISOLATED:'1'}});}
export function checkRuntimePermissions(root){
  const api=compose(root,['ps','-q','api'],{capture:true});
  const user=run('docker',['inspect','-f','{{.Config.User}}',api],{capture:true});
  assert(user&&!['root','0','0:0'].includes(user),'API must run as non-root.');
  run('docker',['exec',api,'sh','-c','test -r /run/secrets/database_connection && test -r /run/secrets/bootstrap_password && test -r /run/secrets/setup_token'],{capture:true});
}
export function copySourceInstall(target,images){
  mkdirSync(target,{recursive:true});
  for(const name of ['compose.yaml','compose.https.yaml','compose.tailnet.yaml','VERSION','.env.example'])if(existsSync(join(sourceRoot,name)))copyFileSync(join(sourceRoot,name),join(target,name));
  for(const name of ['ops','scripts'])cpSync(join(sourceRoot,name),join(target,name),{recursive:true});
  copyFileSync(images,join(target,'compose.images.yaml'));
}
export function install(root,{port,project,mode='sh',extraFiles=[],start=true,hostPath}){
  const url=`http://localhost:${port}`;
  const env={LOVE_CLOUD_PORT:String(port),LOVE_CLOUD_BIND:'127.0.0.1',APP_ORIGIN:url,SECURE_COOKIES:'false'};
  if(hostPath)env.PATH=hostPath;
  if(mode==='pwsh'){
    // -File cannot bind multiple string[] values; a tiny command script uses
    // proper PowerShell argument binding, never interpolation of a token.
    const invocation=join(root,'qa-install.ps1');
    writeFileSync(invocation,"& $PSScriptRoot/scripts/init.ps1 "+(start?'-Start ':'')+"-QuietSecrets -ProjectName $env:QA_PROJECT -Origin $env:APP_ORIGIN -ComposeFile @('compose.yaml','compose.images.yaml'"+extraFiles.map(x=>",'"+x+"'").join('')+")\n");
    run('pwsh',['-NoProfile','-File',invocation],{cwd:root,env:{...env,QA_PROJECT:project}});
  }else run('sh',['scripts/init.sh',...(start?['--start']:[]),'--quiet-secrets','--project',project,'--origin',url,'--compose-file','compose.yaml','--compose-file','compose.images.yaml',...extraFiles.flatMap(x=>['--compose-file',x])],{cwd:root,env});
  return url;
}
export function checkLocked(root,expected,{baseline=false}={}){
  const config=jsonConfig(root);
  for(const service of Object.values(config.services))assert(!service.build,'Production config must not inherit build.');
  for(const name of ['api','frontend','db','gateway']){
    const pattern=baseline&&['api','frontend'].includes(name)?/^sha256:[a-f0-9]{64}$/:/@sha256:[a-f0-9]{64}$/;
    assert.match(config.services[name].image,pattern,'Candidates require registry digests; only explicit local baseline images may use content IDs.');
    if(expected)assert.equal(config.services[name].image,expected.services[name].image,`Same ${name} image across all operations`);
  }
  return config;
}
export function credentials(root){mkdirSync(join(root,'.artifacts'),{recursive:true});}
export async function integration(root,url){credentials(root);test(root,url,'integration');compose(root,['up','-d','--no-build','--force-recreate','db','api']);await ready(url);test(root,url,'persistence');}
export async function onboarding(root,url){
  credentials(root);test(root,url,'onboarding');
  writeFileSync(join(root,'compose.qa-token.yaml'),'secrets:\n  setup_token:\n    file: ./.artifacts/onboarding-rotation-token\n');
  // Append the rotation override to exactly the existing pinned file list.
  const envPath=join(root,'.env');let env=readFileSync(envPath,'utf8');const separator=process.platform==='win32'?';':':';
  env=env.replace(/^COMPOSE_FILE=(.+)$/m,(_,files)=>`COMPOSE_FILE=${files.replace(/^['"]|['"]$/g,'')}${separator}compose.qa-token.yaml`);writeFileSync(envPath,env);
  compose(root,['up','-d','--no-build','--no-deps','--force-recreate','api']);await ready(url);test(root,url,'onboarding-persistence');
}
export function clean(root){if(!existsSync(join(root,'.env')))return;const c=jsonConfig(root);assert.match(c.name,/^lc000-/,'Refusing to destroy a non-test project');compose(root,['down','-v','--remove-orphans']);}
