import {artifact,secret,testBase} from './environment.mjs';
// Full HTTP/SignalR acceptance against a dedicated, disposable Compose project.
// Never point this script at an installation with personal data.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHmac,createHash} from 'node:crypto';
import {avatarPng} from './avatar-fixture.mjs';
import {createRequire} from 'node:module';

const base=testBase('http://localhost:3212');
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const results=[];
const record=(name)=>{results.push({name,passed:true});console.log('PASS '+name);};
const password=()=>randomBytes(24).toString('base64url')+'aA1!';

class Client {
  cookies=new Map(); csrf='';
  get cookieHeader(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');}
  async request(path,{method='GET',body,headers={},expected=200,raw=false}={}) {
    const h={Origin:base,...headers};
    if(this.cookies.size)h.Cookie=this.cookieHeader;
    if(!['GET','HEAD'].includes(method)&&this.csrf)h['X-CSRF-Token']=this.csrf;
    if(body!==undefined && !(body instanceof FormData)){h['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetch(base+path,{method,body,headers:h,redirect:'manual'});
    for(const cookie of response.headers.getSetCookie()) {const first=cookie.split(';')[0];const at=first.indexOf('=');this.cookies.set(first.slice(0,at),first.slice(at+1));}
    const allowed=Array.isArray(expected)?expected:[expected];
    assert(allowed.includes(response.status),`${method} ${path}: expected ${allowed}, received ${response.status}`);
    if(raw)return response;
    if(response.status===204)return null;
    const text=await response.text();return text?JSON.parse(text):null;
  }
  async login(username,pass) {
    const me=await this.request('/api/v1/auth/login',{method:'POST',body:{username,password:pass}});
    this.csrf=(await this.request('/api/v1/auth/csrf')).token;
    return me;
  }
  async changePassword(username,oldPass,newPass) {
    await this.request('/api/v1/auth/change-password',{method:'POST',body:{currentPassword:oldPass,newPassword:newPass},expected:204});
    return this.login(username,newPass);
  }
}
function decode32(value){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of value.toUpperCase().replace(/=|\s/g,'')){const v=alphabet.indexOf(c);assert(v>=0);bits+=v.toString(2).padStart(5,'0');}return Buffer.from((bits.match(/.{8}/g)||[]).map(x=>parseInt(x,2)));}
function totp(secret,offset=0,step=Math.floor(Date.now()/30000)+offset){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const digest=createHmac('sha1',decode32(secret)).update(counter).digest();const at=digest[19]&15;return ((digest.readUInt32BE(at)&0x7fffffff)%1000000).toString().padStart(6,'0');}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSfoAAAAASUVORK5CYII=','base64');
async function upload(client,name,folderId,space='shared') {const form=new FormData();form.append('file',new Blob([png],{type:'image/png'}),name);if(folderId)form.append('folderId',folderId);form.append('space',space);return client.request('/api/v1/files/upload',{method:'POST',body:form,expected:[200,201]});}

let connections=[];
try {
  const anon=new Client(), admin=new Client(), a=new Client(), b=new Client();
  await anon.request('/api/v1/auth/me',{expected:401});record('anonymous access denied');
  const bootstrap=(await readFile(secret('bootstrap_password'),'utf8')).trim();
  let adminMe=await admin.login('admin',bootstrap);assert.equal(adminMe.user.role,'admin');assert.equal(adminMe.user.mustChangePassword,true);
  await admin.request('/api/v1/admin/users',{expected:[401,403]});record('bootstrap requires password change');
  const adminPass=password();adminMe=await admin.changePassword('admin',bootstrap,adminPass);assert.equal(adminMe.user.mustChangePassword,false);
  await admin.request('/api/v1/admin/pair',{method:'PATCH',body:{name:'Integration test pair',timeZone:'Europe/Moscow'},expected:[200,204]});
  const pa=password(),pb=password(),pa2=password(),pb2=password();
  const ua=await admin.request('/api/v1/admin/partners',{method:'POST',body:{username:'test_anna',displayName:'Тестовая Аня',password:pa},expected:[200,201]});
  const ub=await admin.request('/api/v1/admin/partners',{method:'POST',body:{username:'test_misha',displayName:'Тестовый Миша',password:pb},expected:[200,201]});
  await admin.request('/api/v1/admin/partners',{method:'POST',body:{username:'fourth_user',displayName:'Not allowed',password:password()},expected:[400,409]});
  assert.equal((await admin.request('/api/v1/admin/users')).length,3);record('exactly admin plus two partner slots');
  await a.login('test_anna',pa);const ma=await a.changePassword('test_anna',pa,pa2);
  await b.login('test_misha',pb);const mb=await b.changePassword('test_misha',pb,pb2);
  await mkdir(new URL('../.artifacts/',import.meta.url),{recursive:true});
  await writeFile(artifact('test-credentials.json'),JSON.stringify({admin:{username:'admin',password:adminPass},anna:{username:'test_anna',password:pa2},misha:{username:'test_misha',password:pb2}}),{mode:0o600});
  assert.equal((await a.request('/api/v1/pair/members')).length,2);
  await admin.request('/api/v1/files',{expected:403});record('partner access and admin content isolation');
  const saved=a.csrf;a.csrf='invalid';await a.request('/api/v1/tasks',{method:'POST',body:{title:'blocked',priority:'normal',repeat:'none'},expected:403});a.csrf=saved;record('CSRF rejects invalid token');

  const folder=await a.request('/api/v1/folders',{method:'POST',body:{name:'Тестовая папка',space:'shared'},expected:[200,201]});
  const file=await upload(a,'Первый снимок.png',folder.id);
  const bytes=await b.request(file.contentUrl||`/api/v1/files/${file.id}/content`,{raw:true});assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png);
  await anon.request(`/api/v1/files/${file.id}/content`,{expected:[401,403]});
  const range=await a.request(`/api/v1/files/${file.id}/content`,{headers:{Range:'bytes=0-7'},expected:206,raw:true});assert.equal((await range.arrayBuffer()).byteLength,8);record('real file upload/download and byte ranges');
  const album=await a.request('/api/v1/albums',{method:'POST',body:{name:'Тестовый альбом',fileIds:[file.id]},expected:[200,201]});
  const envelope=await a.request('/api/v1/folders/envelope',{method:'POST',body:{name:'Конверт теста',fileIds:[file.id]},expected:[200,201]});
  assert((await a.request(`/api/v1/files?folderId=${envelope.id}`)).some(x=>x.id===file.id));
  assert((await a.request('/api/v1/albums')).find(x=>x.id===album.id).fileIds.includes(file.id));
  await a.request(`/api/v1/files/${file.id}/favorite`,{method:'PUT',expected:204});
  assert((await a.request('/api/v1/files?view=favorites')).some(x=>x.id===file.id));
  await a.request(`/api/v1/files/${file.id}`,{method:'DELETE',expected:204});assert((await a.request('/api/v1/files?view=trash')).some(x=>x.id===file.id));
  await a.request(`/api/v1/files/${file.id}/restore`,{method:'POST',expected:[200,204]});record('envelope references, favorites and trash restore');

  const signalr=require('@microsoft/signalr');
  const connection=new signalr.HubConnectionBuilder().withUrl(base+'/hubs/workspace',{headers:{Cookie:b.cookieHeader,Origin:base},transport:signalr.HttpTransportType.WebSockets}).configureLogging(signalr.LogLevel.None).build();
  let eventResolve;const changed=new Promise(resolve=>eventResolve=resolve);connection.on('WorkspaceChanged',event=>{if(event.area==='posts')eventResolve(event);});
  await connection.start();connections.push(connection);
  const post=await a.request('/api/v1/posts',{method:'POST',body:{kind:'message',body:'Послание с настоящего API ♡',fileIds:[file.id],clientPostId:crypto.randomUUID()},expected:[200,201]});
  await Promise.race([changed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Real-time event timeout')),10000))]);
  const feed=await b.request('/api/v1/feed?kind=message&limit=20');assert(feed.items.some(x=>x.id===post.id));
  await b.request(`/api/v1/posts/${post.id}/heart`,{method:'PUT'});
  await b.request(`/api/v1/posts/${post.id}/replies`,{method:'POST',body:{body:'Ответ второго партнёра',clientPostId:crypto.randomUUID()},expected:[200,201]});
  assert.equal((await a.request(`/api/v1/posts/${post.id}/replies`)).length,1);record('two authenticated partners: social feed, reply, heart and SignalR');
  const avatarForm=new FormData();avatarForm.append('file',new Blob([avatarPng],{type:'image/png'}),'synthetic.png');
  await a.request('/api/v1/profile/avatar',{method:'POST',body:avatarForm,expected:[200,201]});
  const pairForm=new FormData();pairForm.append('file',new Blob([avatarPng],{type:'image/png'}),'couple.png');
  await a.request('/api/v1/pair/avatar',{method:'POST',body:pairForm,expected:[200,201]});
  const avatarMe=await a.request('/api/v1/auth/me');
  const avatarResponse=await a.request(avatarMe.user.avatarUrl,{raw:true});
  const avatarSha256=createHash('sha256').update(Buffer.from(await avatarResponse.arrayBuffer())).digest('hex');
  const pairAvatarResponse=await a.request(avatarMe.pair.avatarUrl,{raw:true});
  const pairAvatarSha256=createHash('sha256').update(Buffer.from(await pairAvatarResponse.arrayBuffer())).digest('hex');
  record('normalized synthetic profile and couple avatars');

  const task=await a.request('/api/v1/tasks',{method:'POST',body:{title:'Общее дело',assigneeId:mb.user.id,dueDate:'2026-10-17',priority:'high',repeat:'weekly',status:'todo'},expected:[200,201]});
  await b.request(`/api/v1/tasks/${task.id}`,{method:'PATCH',body:{status:'done'}});
  await b.request(`/api/v1/tasks/${task.id}`,{method:'PATCH',body:{status:'done'}});
  const tasks=await a.request('/api/v1/tasks');assert.equal(tasks.filter(x=>x.title==='Общее дело').length,2);record('shared planner and one next recurring occurrence');

  const wish=await a.request('/api/v1/wishes',{method:'POST',body:{title:'Идея подарка',note:'Только тест',url:'https://example.com/gift',price:1200,category:'Книги',priority:'high'},expected:[200,201]});
  const before=JSON.stringify((await a.request('/api/v1/wishes')).find(x=>x.id===wish.id));
  await b.request(`/api/v1/wishes/${wish.id}/reservation`,{method:'PUT',body:{status:'reserved'},expected:204});
  const own=(await a.request('/api/v1/wishes')).find(x=>x.id===wish.id);assert(!Object.hasOwn(own,'reservation'));assert.equal(JSON.stringify(own),before);
  assert.equal((await b.request(`/api/v1/wishes?ownerId=${ma.user.id}`)).find(x=>x.id===wish.id).reservation,'reserved');
  await b.request(`/api/v1/wishes/${wish.id}`,{method:'PATCH',body:{title:'forbidden'},expected:[403,404]});record('wish ownership and hidden partner reservation');

  await a.request('/api/v1/files?space=vault',{expected:[401,403,423]});
  const enrollment=await a.request('/api/v1/vault/enrollment',{method:'POST',body:{password:pa2}});
  assert(enrollment.otpauthUri.startsWith('otpauth://totp/'));
  const recovery=await a.request('/api/v1/vault/enrollment/confirm',{method:'POST',body:{code:totp(enrollment.secret)}});assert(recovery.recoveryCodes.length>=5);
  const lastUsedStep=Math.floor(Date.now()/30000)+1;
  const nextCode=totp(enrollment.secret,0,lastUsedStep);
  await a.request('/api/v1/vault/unlock',{method:'POST',body:{code:nextCode}});
  await a.request('/api/v1/vault/unlock',{method:'POST',body:{code:nextCode},expected:[400,401,409]});
  const privateFile=await upload(a,'Закрытый снимок.png',null,'vault');
  await writeFile(artifact('test-totp.json'),JSON.stringify({secret:enrollment.secret,lastUsedStep,privateFileId:privateFile.id}),{mode:0o600});
  await a.request(`/api/v1/files/${privateFile.id}/content`,{raw:true});
  await b.request(`/api/v1/files/${privateFile.id}/content`,{expected:[401,403,423]});
  assert(!(await b.request('/api/v1/files')).some(x=>x.id===privateFile.id));
  await a.request('/api/v1/vault/lock',{method:'POST',expected:204});
  await a.request(`/api/v1/files/${privateFile.id}/content`,{expected:[401,403,423]});record('real TOTP enrollment, replay rejection and server-side vault gate');

  await mkdir(new URL('../.artifacts/',import.meta.url),{recursive:true});
  await writeFile(artifact('integration-state.json'),JSON.stringify({fileId:file.id,taskId:task.id,postId:post.id,folderId:envelope.id,fileSha256:createHash('sha256').update(png).digest('hex'),privateSha256:createHash('sha256').update(png).digest('hex'),avatarSha256,pairAvatarSha256}));
  record('all persisted records created through real PostgreSQL API');
} catch(error){results.push({name:error.message,passed:false});console.error('FAIL '+error.message);process.exitCode=1;}
finally {for(const c of connections)await c.stop().catch(()=>{});await mkdir(new URL('../.artifacts/',import.meta.url),{recursive:true});await writeFile(artifact('integration-results.json'),JSON.stringify({base,at:new Date().toISOString(),results},null,2));}
