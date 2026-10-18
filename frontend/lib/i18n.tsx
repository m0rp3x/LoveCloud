'use client';
import{createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode}from'react';
import english from './en.json';
export type Locale='ru'|'en';
export type Theme='berry'|'rose'|'cloud';
type Params=Record<string,string|number>;
const dictionary=english as Record<string,string>;
const russian=Object.fromEntries(Object.entries(dictionary).map(([ru,en])=>[en,ru]));
export function currentLocale():Locale{return typeof document!=='undefined'&&document.documentElement.lang==='en'?'en':'ru';}
export function intlLocale(){return currentLocale()==='en'?'en-US':'ru-RU';}
export function translateFor(locale:Locale,source:string,params?:Params){const key=source.trim();let value=locale==='en'?(dictionary[key]??key):(dictionary[key]?key:russian[key]??key);if(params)for(const[k,v]of Object.entries(params))value=value.replaceAll('{'+k+'}',String(v));const leading=source.startsWith(' ')?' ':'';const trailing=source.endsWith(' ')?' ':'';return leading+value+trailing;}
export function translate(source:string,params?:Params){return translateFor(currentLocale(),source,params);}
export function localizedError(message:string){const exact=translate(message);if(currentLocale()==='en'&&/[А-Яа-яЁё]/.test(exact))return 'The request could not be completed. Check the fields and try again.';return exact;}
type I18n={locale:Locale;theme:Theme;t:(source:string,params?:Params)=>string;setLocale:(v:Locale)=>void;setTheme:(v:Theme)=>void;apply:(settings:{locale?:Locale;theme?:Theme})=>void};
const Context=createContext<I18n>({locale:'ru',theme:'berry',t:s=>s,setLocale:()=>{},setTheme:()=>{},apply:()=>{}});
export const useI18n=()=>useContext(Context);
export function I18nProvider({children}:{children:ReactNode}){const[locale,setLanguage]=useState<Locale>('ru');const[theme,setAppearance]=useState<Theme>('berry');const setLocale=useCallback((v:Locale)=>{if(typeof document!=='undefined')document.documentElement.lang=v;setLanguage(v);},[]);const setTheme=useCallback((v:Theme)=>{if(typeof document!=='undefined')document.body.dataset.theme=v;setAppearance(v);},[]);const apply=useCallback((s:{locale?:Locale;theme?:Theme})=>{if(s.locale)setLocale(s.locale);if(s.theme)setTheme(s.theme);},[setLocale,setTheme]);const t=useCallback((s:string,p?:Params)=>translateFor(locale,s,p),[locale]);useEffect(()=>{document.documentElement.lang=locale;document.body.dataset.theme=theme;document.title=locale==='en'?'LoveCloud — our space':'LoveCloud — наше пространство';},[locale,theme]);const value=useMemo(()=>({locale,theme,t,setLocale,setTheme,apply}),[locale,theme,t,setLocale,setTheme,apply]);return <Context.Provider value={value}>{children}</Context.Provider>;}
