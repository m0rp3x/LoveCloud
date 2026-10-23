import assert from 'node:assert/strict';
import {resolve,join,basename} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,cpSync,copyFileSync,existsSync,readdirSync,symlinkSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {run,sourceRoot,scratch,projectName,compose,jsonConfig,install,checkLocked,checkRuntimePermissions,ready,test,integration,onboarding,clean} from '../../tests/compose-harness.mjs';

const options={};for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--'));options[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['archive','images','source-sha','report'])assert(options[key],`--${key} is required`);
assert.match(options['source-sha'],/^[a-f0-9]{40}$/);
const report={version:'0.1.0',sourceSha:options['source-sha'],baselineSha:'381a7965e6dab32e7acfc4dfe0184979ceeafab8',platform:'linux/amd64',images:{},checks:[]};
const stage=scratch(),projects=[],resultPath=resolve(options.report);
const save=()=>{mkdirSync(resolve(resultPath,'..'),{recursive:true});writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');};
async function check(name,action){try{const detail=await action();report.checks.push({name,status:'PASS',detail:detail||'Verified against these candidate artifacts.'});save();}catch(error){report.checks.push({name,status:'FAIL',detail:error.message});save();throw error;}}
function extract(archive,target){
  const entries=run('tar',['-tzf',archive],{capture:true}).split('\n');
  for(const entry of entries){assert(entry.startsWith('lovecloud-v0.1.0/'),'Single versioned archive root');assert(!entry.split('/').includes('..'),'No traversal');assert(!/(^|\/)(\.secrets|\.artifacts|node_modules|backend|frontend|backups)(\/|$)/.test(entry),'No private/build/source trees in installation');assert(!/(^|\/)\.env(\/|$)/.test(entry),'No operator environment');}
  mkdirSync(target,{recursive:true});run('tar',['-xzf',archive,'--strip-components=1','-C',target]);
  assert(!existsSync(join(target,'backend'))&&!existsSync(join(target,'frontend')));
}
function syntheticState(from,to){mkdirSync(join(to,'.artifacts'),{recursive:true});for(const file of ['test-credentials.json','integration-state.json','test-totp.json'])copyFileSync(join(from,'.artifacts',file),join(to,'.artifacts',file));}
function secretHashes(root){return Object.fromEntries(['database_password','database_connection','bootstrap_password','setup_token'].map(name=>[name,createHash('sha256').update(readFileSync(join(root,'.secrets',name))).digest('hex')]));}
let checksContainer;
try{
  assert.equal(run('git',['rev-parse','HEAD'],{capture:true}),options['source-sha'],'QA checkout must be the exact release commit.');
  run('git',['diff','--exit-code'],{capture:true});run('git',['diff','--cached','--exit-code'],{capture:true});
  const archive=resolve(options.archive),lock=resolve(options.images),candidate=join(stage,'candidate');
  await check('install archive allowlist',()=>{extract(archive,candidate);assert.equal(readFileSync(join(candidate,'VERSION'),'utf8').trim(),'0.1.0');assert.equal(readFileSync(join(candidate,'compose.images.yaml'),'utf8'),readFileSync(lock,'utf8'));for(const file of ['LICENSE','THIRD_PARTY_NOTICES','scripts/init.sh','scripts/init.ps1'])assert(existsSync(join(candidate,file)),`Included ${file}`);return 'Opened actual release tar.gz; no app source, personal environment or secrets.';});
  await check('ZIP contents match verified tar archive',()=>{
    const zip=resolve(options.zip||archive.replace(/\.tar\.gz$/,'.zip'));assert(existsSync(zip),'Matching install.zip artifact required beside tar.gz or via --zip.');
    run('python',['-c',"import sys,zipfile,tarfile,hashlib\nwith zipfile.ZipFile(sys.argv[1]) as z, tarfile.open(sys.argv[2]) as t:\n a={x.filename:hashlib.sha256(z.read(x)).hexdigest() for x in z.infolist() if not x.is_dir()}\n b={x.name:hashlib.sha256(t.extractfile(x).read()).hexdigest() for x in t.getmembers() if x.isfile()}\n assert a==b, 'ZIP/tar payload mismatch'",zip,archive]);return 'Opened ZIP with CRC/content reads; every file SHA256 matches tar.gz payload.';
  });
  const project=projectName('setup');projects.push(candidate);
  const hostPath=join(stage,'docker-only-host');mkdirSync(hostPath);
  for(const tool of ['sh','docker','openssl','dirname','sed','tail','head','awk','tr','grep','printenv','mktemp','mv','mkdir','chmod','find','cat','sleep']){
    const path=run('sh',['-c','command -v "$1"','sh',tool],{capture:true});assert(path.startsWith('/'),`External tool path ${tool}`);symlinkSync(path,join(hostPath,tool));
  }
  run('sh',['-c','! command -v node && ! command -v dotnet && ! command -v git'],{env:{PATH:hostPath}});
  const candidateUrl=install(candidate,{project,port:33213,hostPath});await ready(candidateUrl);
  const expected=checkLocked(candidate);report.images={api:expected.services.api.image,frontend:expected.services.frontend.image};save();
  await check('shell installation from archive',()=>{const hashes=secretHashes(candidate);install(candidate,{project,port:33213,hostPath});assert.deepEqual(secretHashes(candidate),hashes);checkLocked(candidate,expected);checkRuntimePermissions(candidate);return 'Fresh start/rerun with host PATH excluding Node/.NET/Git, only Docker+shell/OpenSSL/POSIXtools; same images/secrets and non-root mounted secret readability.';});
  await check('initial setup, avatars, access and restart',async()=>{await onboarding(candidate,candidateUrl);checkLocked(candidate,expected);});
  await check('private images and removed optimizer',async()=>{const r=await fetch(candidateUrl+'/_next/image?url=%2Fapi%2Fv1%2Ffiles%2Fnone%2Fcontent&w=640&q=75');assert.equal(r.status,404);run('docker',['run','--rm','--entrypoint','node',expected.services.frontend.image,'-e',"const fs=require('fs');for(const p of ['/app/node_modules/sharp','/app/node_modules/@img'])if(fs.existsSync(p))throw Error('Unexpected sharp/libvips native runtime: '+p);"]);return 'Optimizer endpoint404; sharp/@img absent from actual frontend runtime; authenticated raw image coverage below.';});
  const candidateHttpRoot=join(stage,'powershell');let candidateHttpUrl;
  await check('PowerShell installation from archive',async()=>{const ps=candidateHttpRoot;extract(archive,ps);projects.push(ps);const url=install(ps,{project:projectName('ps'),port:33215,mode:'pwsh'});candidateHttpUrl=url;await ready(url);const hashes=secretHashes(ps);install(ps,{project:jsonConfig(ps).name,port:33215,mode:'pwsh'});assert.deepEqual(secretHashes(ps),hashes);checkLocked(ps,expected);checkRuntimePermissions(ps);return 'PowerShell7 Linux Docker startup/rerun and actual non-root mounted secret readability.';});
  await check('candidate HTTP, files, Range and SignalR',async()=>{
    await integration(candidateHttpRoot,candidateHttpUrl);checkLocked(candidateHttpRoot,expected);
    return 'Fresh final candidate images: authenticated HTTP/roles/CSRF, ordinary and vault original checksums, byte ranges, social feed/replies/hearts and actual two-partner SignalR, planner/wishes/TOTP, then same-digest DB/API recreation and persistence.';
  });
  await check('backend core, native avatars and setup races',()=>{
    checksContainer=projectName('checks');const password=randomBytes(24).toString('hex');const passwordPath=join(stage,'postgres-password');writeFileSync(passwordPath,password,{mode:0o600});
    run('docker',['run','-d','--name',checksContainer,'-p','127.0.0.1::5432','--mount',`type=bind,source=${passwordPath},target=/run/check-password,readonly`,'-e','POSTGRES_PASSWORD_FILE=/run/check-password',expected.services.db.image],{capture:true});
    const mapped=run('docker',['port',checksContainer,'5432/tcp'],{capture:true}).split(':').pop();
    const connection=join(stage,'checks-connection');writeFileSync(connection,`Host=127.0.0.1;Port=${mapped};Database=postgres;Username=postgres;Password=${password}`,{mode:0o600});
    // pg readiness is explicitly required before the checks create disposable DBs.
    for(let n=0;n<90;n++){if(run('docker',['exec',checksContainer,'pg_isready','-U','postgres'],{allowFailure:true,capture:false})===0)break;run('sleep',['1']);}
    run('dotnet',['run','--configuration','Release','--project','backend/tests/LoveCloud.Checks.csproj'],{env:{LOVECLOUD_CHECKS_CONNECTION_FILE:connection,LOVECLOUD_REQUIRE_SETUP_RACES:'1'}});
    return 'Real disposable PostgreSQL superuser permits uniquely named database creation; race checks explicitly enabled.';
  });
  if(!options['baseline-images']){report.checks.push({name:'baseline backup/restore/upgrade',status:'NOT RUN',detail:'--baseline-images for exact baseline381a796 is required.'});save();throw new Error('Mandatory baseline image lock missing.');}
  const original=join(stage,'original');extract(archive,original);copyFileSync(resolve(options['baseline-images']),join(original,'compose.images.yaml'));
  const originalProject=projectName('upgrade');projects.push(original);
  writeFileSync(join(original,'compose.qa-volumes.yaml'),`volumes:\n  files:\n    name: ${originalProject}_custom_originals\n  keys:\n    name: ${originalProject}_custom_keyring\n  pgdata:\n    name: ${originalProject}_custom_pg18\nnetworks:\n  private:\n    name: ${originalProject}_custom_network\n`);
  const originalUrl=install(original,{project:originalProject,port:33212,extraFiles:['compose.qa-volumes.yaml'],start:false});
  compose(original,['pull','db','gateway']);compose(original,['up','-d','--no-build','--pull','never']);await ready(originalUrl);
  const originalConfig=checkLocked(original,undefined,{baseline:true}),volumesBefore={...originalConfig.volumes},networksBefore={...originalConfig.networks};
  report.baselineImages={api:originalConfig.services.api.image,frontend:originalConfig.services.frontend.image};save();
  await check('baseline synthetic functional data',async()=>{await integration(original,originalUrl);return 'Baseline381a796 accounts, folders, byte ranges, profile/couple avatars, post, recurring task, wishes, SignalR and real TOTP/vault originals, with exact SHA256.';});
  const repository=join(stage,'encrypted-backup');
  await check('consistent encrypted backup',()=>{run('sh',['scripts/backup.sh','--repository',repository],{cwd:original});assert(existsSync(join(repository,'config')));return 'API stopped for pg_dump + actual original/key mounts; restic check; .env/Compose/secrets included; key stored separately.';});
  const restored=join(stage,'restored');projects.push(restored);
  await check('restore isolated project and originals',async()=>{
    run('sh',[join(original,'scripts/restore.sh'),'--repository',repository,'--password-file',join(original,'.secrets/backup_password'),'--target',restored,'--project',projectName('restore'),'--origin','http://localhost:33214','--port','33214'],{env:{LOVECLOUD_BACKUP_IMAGE:process.env.LOVECLOUD_BACKUP_IMAGE||''}});
    syntheticState(original,restored);await ready('http://localhost:33214');test(restored,'http://localhost:33214','persistence');
    const restoredConfig=jsonConfig(restored);assert.notEqual(restoredConfig.name,originalProject);assert.notEqual(restoredConfig.networks.private.name,originalConfig.networks.private.name);
    assert(Object.values(restoredConfig.volumes).every(v=>v.name.startsWith(restoredConfig.name+'_restore_')),'No original volume names survive restored config');
    return 'Separate fresh volumes/network; existing accounts/publication/task/avatar hashes, original/vault checksums and decryptable TOTP key ring verified.';
  });
  await check('PowerShell encrypted backup and restore',async()=>{
    const repo=join(stage,'encrypted-backup-ps'),destination=join(stage,'restored-ps');projects.push(destination);
    const restoredProject=projectName('psrestore'),restoredOrigin='http://localhost:33216';
    // The shell gate above restores the original baseline. PowerShell parity
    // restores the fully seeded final candidate, so all recreated services use
    // final release digests without editing its saved settings or injecting env.
    run('pwsh',['-NoProfile','-File','scripts/backup.ps1','-Repository',repo],{cwd:candidateHttpRoot});
    run('pwsh',['-NoProfile','-File',join(candidateHttpRoot,'scripts/restore.ps1'),'-Repository',repo,'-PasswordFile',join(candidateHttpRoot,'.secrets/backup_password'),'-Target',destination,'-ProjectName',restoredProject,'-Origin',restoredOrigin,'-Port','33216']);
    syntheticState(candidateHttpRoot,destination);await ready(restoredOrigin);test(destination,restoredOrigin,'persistence');
    const settingsPath=join(destination,'.env'),savedSettings=readFileSync(settingsPath,'utf8');
    const savedFileList=savedSettings.match(/^COMPOSE_FILE=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g,'').split(':');
    assert.deepEqual(savedFileList,['compose.backup.1.yaml','compose.backup.2.yaml','compose.restore.yaml'],'Persist every restored Compose override in its original order.');
    const restoredConfig=checkLocked(destination,expected);
    assert.equal(restoredConfig.name,restoredProject,'Persist the new isolated project name.');
    assert.equal(restoredConfig.services.api.environment.App__Origin,restoredOrigin,'Read restored origin from saved settings.');
    assert.equal(String(restoredConfig.services.api.environment.App__SecureCookies),'false','Read HTTP cookie policy from saved settings.');
    assert.equal(restoredConfig.networks.private.name,restoredProject+'_restore_private');
    assert(Object.values(restoredConfig.volumes).every(volume=>volume.name.startsWith(restoredProject+'_restore_')),'Keep all restored volumes isolated.');
    const restoredSecrets=secretHashes(destination);assert.deepEqual(restoredSecrets,secretHashes(candidateHttpRoot));
    compose(destination,['up','-d','--no-build','--force-recreate']);await ready(restoredOrigin);
    assert.deepEqual(checkLocked(destination,expected),restoredConfig,'Recreate all final services using the same persisted configuration.');
    assert.equal(readFileSync(settingsPath,'utf8'),savedSettings);assert.deepEqual(secretHashes(destination),restoredSecrets);
    test(destination,restoredOrigin,'persistence');
    return 'Actual PowerShell7 Linux Docker encrypted candidate backup/restore; saved project, ordered Compose overrides, origin/cookies, volumes/network and exact release digests verified without environment overrides; all services recreated, then original/avatar/vault hashes and decryptable TOTP verified again.';
  });
  await check('update same project and custom volumes',async()=>{
    const hashes=secretHashes(original);copyFileSync(lock,join(original,'compose.images.yaml'));
    compose(original,['pull']);compose(original,['up','-d','--no-build']);await ready(originalUrl);
    const config=checkLocked(original,expected);assert.equal(config.name,originalProject);assert.deepEqual(config.volumes,volumesBefore);assert.deepEqual(config.networks,networksBefore);assert.deepEqual(secretHashes(original),hashes);
    test(original,originalUrl,'persistence');return 'No renaming/no volume recreation; persisted origin/custom source list/secrets/PostgreSQL18 mount preserved.';
  });
  await check('candidate recreation persistence',async()=>{compose(original,['up','-d','--no-build','--force-recreate']);await ready(originalUrl);checkLocked(original,expected);test(original,originalUrl,'persistence');});
  report.checks.push({name:'Windows Docker full installation',status:'NOT RUN',required:false,detail:'Not a supported release platform; PowerShell7 on Linuxamd64 is tested, native WindowsDocker daemon unavailable.'});
  report.checks.push({name:'operator public HTTPS and Tailscale authorization',status:'NOT RUN',required:false,detail:'Installer configuration fixtures cover HTTPS origins and overrides. Live domain certificates and tailnet authorization depend on operator infrastructure; this candidate acceptance uses isolated loopback HTTP.'});
}catch(error){if(!report.checks.some(c=>c.status==='FAIL'))report.checks.push({name:'candidate orchestration',status:'FAIL',detail:error.message});console.error('FAIL candidate acceptance: '+error.message);process.exitCode=1;}
finally{
  if(checksContainer)run('docker',['rm','-f','-v',checksContainer],{allowFailure:true,capture:true});
  for(const root of projects.reverse()){try{clean(root);}catch(error){console.error('Disposable cleanup failed: '+error.message);process.exitCode=1;}}
  save();
}
