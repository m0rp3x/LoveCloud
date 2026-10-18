import ts from 'typescript';
import{readdir,readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
const root=resolve(import.meta.dirname,'..');
const selected=['auth.tsx','cloud.tsx','lovecloud.tsx','planner.tsx','social.tsx','ui.tsx','vault.tsx','wishes.tsx'];
const strings=new Set();
for(const file of selected){const path=resolve(root,'components',file);const source=await readFile(path,'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const visit=node=>{if((ts.isStringLiteral(node)||ts.isJsxText(node))&&/[А-Яа-яЁё]/.test(node.text))strings.add(node.text.replace(/\s+/g,' ').trim());ts.forEachChild(node,visit);};visit(ast);}
await mkdir(resolve(root,'.artifacts'),{recursive:true});await writeFile(resolve(root,'.artifacts/i18n-source.json'),JSON.stringify([...strings].sort(),null,2));
if(!process.argv.includes('--apply')){console.log(`${strings.size} static strings collected`);process.exit(0);}
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const file of selected){const path=resolve(root,'components',file);const source=await readFile(path,'utf8');if(source.includes("from '@/lib/i18n'"))continue;const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const result=ts.transform(ast,[context=>{const f=context.factory;const call=text=>f.createCallExpression(f.createIdentifier('t'),undefined,[f.createStringLiteral(text)]);
  const insideFunction=node=>{for(let p=node.parent;p;p=p.parent)if(ts.isFunctionDeclaration(p)||ts.isArrowFunction(p)||ts.isFunctionExpression(p))return true;return false;};
  const visitor=node=>{
   if(ts.isJsxText(node)&&/[А-Яа-яЁё]/.test(node.text))return f.createJsxExpression(undefined,call(node.text.replace(/\s+/g,' ')));
   if(ts.isStringLiteral(node)&&/[А-Яа-яЁё]/.test(node.text)&&insideFunction(node)){
    if(ts.isPropertyAssignment(node.parent)&&node.parent.name===node)return node;
    if(ts.isJsxAttribute(node.parent))return f.createJsxExpression(undefined,call(node.text));
    return call(node.text);
   }
   const updated=ts.visitEachChild(node,visitor,context);
   if(ts.isFunctionDeclaration(updated)&&updated.name&&/^[A-Z]/.test(updated.name.text)&&updated.body){const hook=f.createVariableStatement(undefined,f.createVariableDeclarationList([f.createVariableDeclaration(f.createObjectBindingPattern([f.createBindingElement(undefined,undefined,'t')]),undefined,undefined,f.createCallExpression(f.createIdentifier('useI18n'),undefined,[]))],ts.NodeFlags.Const));return f.updateFunctionDeclaration(updated,updated.modifiers,updated.asteriskToken,updated.name,updated.typeParameters,updated.parameters,updated.type,f.updateBlock(updated.body,[hook,...updated.body.statements]));}
   return updated;
  };return node=>ts.visitNode(node,visitor);
 }]);let output=printer.printFile(result.transformed[0]);output=output.replace(/(['"]use client['"];)/,"$1\nimport {useI18n, translate as t} from '@/lib/i18n';");await writeFile(path,output);result.dispose();
}
console.log('Static literals converted to explicit dictionary calls; dynamic user content unchanged.');
