import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';
const root=resolve(import.meta.dirname,'../components');
for(const file of ['auth.tsx','cloud.tsx','lovecloud.tsx','planner.tsx','social.tsx','ui.tsx','vault.tsx','wishes.tsx']){const path=resolve(root,file);let s=await readFile(path,'utf8');s=s.replace(/\\u([0-9a-fA-F]{4})/g,(match,hex)=>{const c=parseInt(hex,16);return c>=0x80&&c!==0x2028&&c!==0x2029?String.fromCharCode(c):match;});
 if(file==='planner.tsx'){const start=s.indexOf('const card = (t: Task)');const end=s.indexOf('const days =',start);if(start>=0){let part=s.slice(start,end).replace('(t: Task)','(task: Task)').replace(/\bt\./g,'task.').replaceAll('update(t,','update(task,').replaceAll('setEditing(t)','setEditing(task)');s=s.slice(0,start)+part+s.slice(end);}s=s.replace('{label}<span>','{t(label)}<span>');}
 s=s.replace(/\{priorityLabels\[([^\]]+)\]\}/g,'{t(priorityLabels[$1])}').replace(/\{repeats\[([^\]]+)\]\}/g,'{t(repeats[$1])}').replaceAll('>{l}</option>','>{t(l)}</option>');
 if(file==='lovecloud.tsx')s=s.replaceAll('<span>{title}</span>','<span>{t(title)}</span>');
 if(file==='ui.tsx'){s=s.replace("translate as t}","translate as t, intlLocale, localizedError}").replace("const russianPlural = new Intl.PluralRules('ru-RU');",'').replace('russianPlural.select(count)',"new Intl.PluralRules(intlLocale()).select(count)").replaceAll("new Intl.NumberFormat('ru-RU',",'new Intl.NumberFormat(intlLocale(),').replaceAll("new Intl.DateTimeFormat('ru-RU',",'new Intl.DateTimeFormat(intlLocale(),').replace('error instanceof Error ? error.message','error instanceof Error ? localizedError(error.message)');}
 if(file==='planner.tsx'||file==='wishes.tsx'){s=s.replace('translate as t}', 'translate as t, intlLocale}').replaceAll("new Intl.NumberFormat('ru-RU',",'new Intl.NumberFormat(intlLocale(),').replaceAll("new Intl.DateTimeFormat('ru-RU',",'new Intl.DateTimeFormat(intlLocale(),');}
 await writeFile(path,s);
}
