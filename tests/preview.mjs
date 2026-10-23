// QA-only Playwright; install it in a temporary tooling prefix, not the app.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFileSync,mkdirSync,readFileSync,readdirSync,statSync} from 'node:fs';
const args={};for(let n=2;n<process.argv.length;n+=2)args[process.argv[n].replace(/^--/,'')]=process.argv[n+1];
const url=new URL(args.url||'http://127.0.0.1:33210/LoveCloud/');
assert.equal(url.pathname,'/LoveCloud/','Test the project Pages prefix, not only root hosting.');
const require=createRequire(resolve(process.env.LOVECLOUD_PLAYWRIGHT_ROOT||'.artifacts/browser','package.json'));
const {chromium}=require('playwright');
const launch={headless:true};if(process.env.LOVECLOUD_CHROMIUM_PATH)launch.executablePath=process.env.LOVECLOUD_CHROMIUM_PATH;
const browser=await chromium.launch(launch),checks=[],requests=[],failures=[],errors=[];
const result={sourceSha:process.env.GITHUB_SHA||null,url:url.href,checks};
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
context.on('request',request=>{requests.push({url:request.url(),method:request.method()});if(new URL(request.url()).origin!==url.origin||request.method()!=='GET'||/\/api\/|\/hubs\//.test(request.url()))failures.push(request.url());});
context.on('response',response=>{if(response.status()>=400)failures.push(response.status()+' '+response.url());});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const pass=(name,detail)=>{checks.push({name,status:'PASS',detail});console.log('PASS '+name);};
async function nav(page,name){let item=page.locator(`[data-nav="${name}"]`).first();if(!await item.isVisible())await page.locator('[data-mobile-menu]').click();await item.click();}
async function create(page,kind,name){await page.locator(`[data-action="new-${kind}"]`).first().click();const form=page.locator(`[data-form="${kind}"]`);await form.locator(`[name="${kind==='folder'?'name':'title'}"]`).fill(name);await form.locator('[type="submit"]').click();await page.getByText(name,{exact:true}).first().waitFor();}
try{
  await page.goto(url.href,{waitUntil:'networkidle'});
  assert.match(await page.locator('body').innerText(),/Интерактивный предпросмотр/);
  assert.equal(await page.locator('input[type="file"]').count(),0);
  const csp=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');assert.match(csp,/connect-src 'none'/);assert.match(csp,/form-action 'none'/);
  assert(await page.locator('a[href="https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0"]').count()>0);
  pass('Pages prefix assets, clear simulation notice and installation link');
  const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(url.href,{waitUntil:'networkidle'});
  const suffix=Date.now().toString(),folder='QA folder '+suffix,task='QA task '+suffix,wish='QA wish '+suffix,note='QA note '+suffix;
  await create(page,'folder',folder);assert.equal(await second.getByText(folder,{exact:true}).count(),0);pass('folder creation and independent tabs');
  await nav(page,'planner');await create(page,'task',task);
  await nav(page,'wishes');await create(page,'wish',wish);
  await nav(page,'messages');const form=page.locator('[data-form="post"]');await form.locator('[name="text"]').fill(note);await form.locator('[type="submit"]').click();await page.getByText(note,{exact:true}).waitFor();
  pass('planner, wish and social publication actions');
  await nav(page,'vault');const vault=page.locator('[data-form="vault"]');await vault.locator('[name="code"]').fill('654321');await vault.locator('[type="submit"]').click();assert.equal(await page.locator('.wp-vault-unlocked').count(),0);await vault.locator('[name="code"]').fill('123456');await vault.locator('[type="submit"]').click();await page.locator('.wp-vault-unlocked').waitFor();pass('explicit simulated vault code');
  await nav(page,'cloud');await page.locator('[data-upload]').first().click();assert.equal(await page.locator('input[type="file"]').count(),0);await page.locator('[data-form="upload"] [type="submit"]').click();await page.getByText('Вечерняя прогулка.jpg',{exact:true}).first().waitFor();pass('synthetic upload without real file selection');
  await Promise.all([page.waitForEvent('load'),page.locator('[data-reset-demo]').click()]);await page.waitForLoadState('networkidle');assert.equal(await page.getByText(folder,{exact:true}).count(),0);await nav(page,'messages');assert.equal(await page.getByText(note,{exact:true}).count(),0);pass('reset clears in-memory changes');
  await page.setViewportSize({width:390,height:844});await nav(page,'planner');await create(page,'task','QA mobile task');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal page overflow at390px');pass('mobile navigation and creation at390px');
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'No persistent browser data');assert.deepEqual(failures,[],'No external/failed/backend/POST requests');assert.deepEqual(errors,[],'No browser JavaScript errors');pass('local resources only, no backend traffic or persistent state',`${requests.length} successful same-origin GET resource requests.`);
}catch(error){checks.push({name:'preview acceptance',status:'FAIL',detail:error.message});console.error(error);process.exitCode=1;}
finally{await browser.close();if(args.report){mkdirSync(resolve(args.report,'..'),{recursive:true});writeFileSync(args.report,JSON.stringify(result,null,2)+'\n');}}
