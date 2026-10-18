import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'public/fonts'),{recursive:true});
for(const [family,directory,stem] of [['Caveat','caveat','Caveat'],['Golos Text','golostext','GolosText'],['Rubik','rubik','Rubik']]){
 const base=`https://raw.githubusercontent.com/google/fonts/main/ofl/${directory}/`;
 for(const [source,destination]of [[`${stem}[wght].ttf`,`${stem}.ttf`],['OFL.txt',`${stem}-OFL.txt`]]){
  const url=base+encodeURIComponent(source);const response=await fetch(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);
  const bytes=new Uint8Array(await response.arrayBuffer());await writeFile(resolve(root,'public/fonts',destination),bytes);console.log(`${family}: ${destination} (${bytes.length} bytes)`);
 }
}
for(const file of ['shell.css','drawn.css']){const path=resolve(root,'app/styles',file);const css=await readFile(path,'utf8');await writeFile(path,css.replace(/@import url\('https:\/\/fonts\.googleapis\.com\/[^']+'\);\s*/g,''));}
await writeFile(resolve(root,'app/styles/fonts.css'),`/* Google Fonts upstream, SIL Open Font License. See public/fonts/*-OFL.txt. */
@font-face{font-family:'Caveat';font-style:normal;font-weight:400 700;font-display:swap;src:url('/fonts/Caveat.ttf') format('truetype')}
@font-face{font-family:'Golos Text';font-style:normal;font-weight:400 900;font-display:swap;src:url('/fonts/GolosText.ttf') format('truetype')}
@font-face{font-family:'Rubik';font-style:normal;font-weight:300 900;font-display:swap;src:url('/fonts/Rubik.ttf') format('truetype')}
`);
