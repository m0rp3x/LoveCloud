import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {avatarPng as png} from './avatar-fixture.mjs';
const base='http://localhost:3213';
const results=[];
const pass=name=>{results.push({name,passed:true});console.log('PASS '+name);};
const password=()=>randomBytes(24).toString('base64url')+'aA1!';
class Client{
 cookies=new Map();setupCsrf='';csrf='';
 get cookieHeader(){return [...this.cookies].map(([k,v])=>k+'='+v).join('; ');}
 async call(path,{method='GET',body,headers={},status=200,raw=false}={}){
  const h={Origin:base,'Accept-Language':'en',...headers};if(this.cookies.size)h.Cookie=this.cookieHeader;
  if(this.setupCsrf)h['X-Setup-CSRF']=this.setupCsrf;if(this.csrf)h['X-CSRF-Token']=this.csrf;
  if(body!==undefined&&!(body instanceof FormData)){h['Content-Type']='application/json';body=JSON.stringify(body);}
  const r=await fetch(base+'/api/v1'+path,{method,body,headers:h,redirect:'manual'});
  for(const c of r.headers.getSetCookie()){const first=c.split(';')[0],at=first.indexOf('=');this.cookies.set(first.slice(0,at),first.slice(at+1));}
  assert((Array.isArray(status)?status:[status]).includes(r.status),`${method} ${path}: received ${r.status}, expected ${status}`);
  if(raw)return r;if(r.status===204)return null;const text=await r.text();return text?JSON.parse(text):null;
 }
 async upload(path,bytes,name='avatar.png',status=[200,201]){const f=new FormData();f.append('file',new Blob([bytes],{type:'image/png'}),name);return this.call(path,{method:'POST',body:f,status});}
 async login(username,pass){const me=await this.call('/auth/login',{method:'POST',body:{username,password:pass}});this.csrf=(await this.call('/auth/csrf')).token;return me;}
}
try{
 const owner=new Client(),other=new Client(),anon=new Client();
 const token=(await readFile(new URL('../.secrets/setup_token',import.meta.url),'utf8')).trim();assert.match(token,/^[a-f0-9]{64}$/i);
 const status=await anon.call('/setup/status');assert.equal(status.required,true);pass('fresh installation requires setup');
 await anon.call('/setup/exchange',{method:'POST',body:{token},headers:{Origin:'https://invalid.example'},status:403});
 await anon.call('/setup/exchange',{method:'POST',body:{token:'0'.repeat(64)},status:[400,401,403]});pass('setup Origin and invalid-token rejection');
 const exchanged=await owner.call('/setup/exchange',{method:'POST',body:{token}});owner.setupCsrf=exchanged.csrfToken;assert(owner.setupCsrf);
 assert.equal((await owner.call('/setup/session')).csrfToken,owner.setupCsrf);
 await other.call('/setup/exchange',{method:'POST',body:{token},status:[401,403,409]});pass('atomic link claim and reload session');
 const validSetupCsrf=owner.setupCsrf;owner.setupCsrf='wrong';await owner.upload('/setup/avatar',png,'avatar.png',[400,403]);owner.setupCsrf=validSetupCsrf;pass('setup-specific CSRF protects writes');
 const pairAvatar=await owner.upload('/setup/avatar',png);
 const firstAvatar=await owner.upload('/setup/avatar',png);
 const discarded=await owner.upload('/setup/avatar',png);
 const resumed=await owner.call('/setup/session');assert.equal(resumed.pendingAvatars.length,3);assert(resumed.pendingAvatars.some(x=>x.id===firstAvatar.id));
 await owner.upload('/setup/avatar',png,'fourth.png',[400,409]);
 await owner.call('/setup/avatar/'+discarded.id,{method:'DELETE',status:204});
 const secondAvatar=await owner.upload('/setup/avatar',png);
 await anon.call(pairAvatar.url.replace('/api/v1',''),{status:[401,403,404]});
 const preview=await owner.call(pairAvatar.url.replace('/api/v1',''),{raw:true});const avatarBytes=Buffer.from(await preview.arrayBuffer());assert(avatarBytes.length>8);assert.deepEqual(avatarBytes.subarray(0,8),png.subarray(0,8));assert(preview.headers.get('content-type').startsWith('image/png'));pass('real normalized avatars, ownership, replacement and private previews');
 const bootstrapPassword=(await readFile(new URL('../.secrets/bootstrap_password',import.meta.url),'utf8')).trim();
 const mixed=new Client();await mixed.login('admin',bootstrapPassword);for(const[k,v]of owner.cookies)mixed.cookies.set(k,v);
 await mixed.call(pairAvatar.url.replace('/api/v1',''),{raw:true});pass('setup avatar preview works with an old must-change admin cookie');
 await owner.call('/setup/avatar/'+secondAvatar.id,{method:'DELETE',status:204});
 await owner.upload('/setup/avatar',Buffer.alloc(2*1024*1024+1),'large.png',[400,413]);
 const finalSecondAvatar=await owner.upload('/setup/avatar',png);pass('avatar upload size limit');
 const adminPass=password(),firstPass=password(),secondPass=password();
 const draft={locale:'en',theme:'cloud',pair:{name:'Our private cloud',startDate:'2026-10-17',timeZone:'Europe/Moscow',avatarId:pairAvatar.id},adminPassword:adminPass,partners:[{username:'setup_owner',displayName:'Cloud Owner',password:firstPass,avatarId:firstAvatar.id},{username:'setup_mate',displayName:'Cloud Partner',password:secondPass,avatarId:finalSecondAvatar.id}]};
 const invalid=structuredClone(draft);invalid.partners[1].username=invalid.partners[0].username;
 await owner.call('/setup/complete',{method:'POST',body:invalid,status:[400,409]});assert.equal((await anon.call('/setup/status')).required,true);pass('invalid completion rolls back without finishing setup');
 const session=await owner.call('/setup/complete',{method:'POST',body:draft});assert.equal(session.user.role,'partner');assert.equal(session.user.mustChangePassword,false);assert.equal(session.pair.locale,'en');assert.equal(session.pair.theme,'cloud');assert(session.user.avatarUrl&&session.pair.avatarUrl);
 owner.csrf=(await owner.call('/auth/csrf')).token;
 assert.equal((await anon.call('/setup/status')).required,false);
 await other.call('/setup/exchange',{method:'POST',body:{token},status:[401,403,409,410]});
 await owner.call('/setup/complete',{method:'POST',body:draft,status:[401,403,409,410]});pass('one completion creates cloud and permanently consumes setup access');
 const admin=new Client();await admin.login('admin',adminPass);assert.equal((await admin.call('/admin/users')).length,3);
 const members=await owner.call('/pair/members');assert.equal(members.length,2);assert(members.every(m=>m.avatarUrl));
 const mate=new Client();const mateSession=await mate.login('setup_mate',secondPass);assert.equal(mateSession.user.mustChangePassword,true);pass('three account slots, chosen admin password and partner first-password policy');
 for(const theme of ['berry','rose','cloud']){await owner.call('/settings/appearance',{method:'PATCH',body:{theme,locale:theme==='rose'?'ru':'en'}});const me=await owner.call('/auth/me');assert.equal(me.pair.theme,theme);assert.equal(me.pair.locale,theme==='rose'?'ru':'en');}pass('three themes and RU/EN persist through appearance API');
 const changedAvatar=await owner.upload('/profile/avatar',png);assert(changedAvatar.avatarUrl);
 await owner.call('/profile/avatar',{method:'DELETE',status:204});assert.equal((await owner.call('/auth/me')).user.avatarUrl,undefined);
 await owner.upload('/profile/avatar',png);
 await owner.upload('/pair/avatar',png);assert((await owner.call('/auth/me')).pair.avatarUrl);pass('real profile and pair avatar updates');
 const ownMe=await owner.call('/auth/me');
 const post=await owner.call('/posts',{method:'POST',body:{kind:'message',body:'Our first note',clientPostId:crypto.randomUUID()}});assert.equal(post.authorAvatarUrl,ownMe.user.avatarUrl);pass('author avatar is used by real social publications');
 await mkdir(new URL('../.artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../.artifacts/onboarding-credentials.json',import.meta.url),JSON.stringify({username:'setup_owner',password:firstPass}),{mode:0o600});
 await writeFile(new URL('../.artifacts/onboarding-rotation-token',import.meta.url),randomBytes(32).toString('hex'),{mode:0o600});
}catch(e){results.push({name:e.message,passed:false});console.error('FAIL '+e.message);process.exitCode=1;}
finally{await mkdir(new URL('../.artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../.artifacts/onboarding-results.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),results},null,2));}
