'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeShow,summarize,matches,createClient,language,safeLink}=require('../audio.js');
const now=Date.UTC(2026,9,9),epoch=Math.floor(now/1000);
const offer=(service,audios,extra={})=>({service:{id:service},type:'subscription',audios:audios.map(language=>({language})),link:service==='netflix'?'https://www.netflix.com/title/123':'https://play.hbomax.com/movie/123',...extra});
const show=(options,id=1,type='movie')=>({tmdbId:`${type}/${id}`,showType:type==='tv'?'series':'movie',streamingOptions:{cz:options,sk:[offer('netflix',['ces'])]}});
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function memory(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test('ISO 639-2 terminology and bibliographic aliases',()=>{for(const c of ['cs','ces','cze','CES','cs-CZ'])assert.equal(language(c),'cs');for(const c of ['sk','slk','slo'])assert.equal(language(c),'sk');});
test('Czech audio is linked to the exact subscription service and Czech region',()=>{
 const v=normalizeShow(show([offer('netflix',['eng']),offer('hbo',['ces'])]),'movie',1,now);
 assert.equal(matches(v,['netflix'],'cs'),false);assert.equal(matches(v,['hbo'],'cs'),true);assert.equal(matches(v,['netflix','hbo'],'cs-sk'),true);
});
test('subtitles, original and spoken languages are not evidence of dubbing',()=>{
 const raw=show([offer('netflix',['eng'],{subtitles:[{locale:{language:'ces'}}]})]);raw.original_language='cs';raw.spoken_languages=[{iso_639_1:'cs'}];
 const v=normalizeShow(raw,'movie',1,now);assert.equal(matches(v,['netflix'],'cs'),false);
});
test('rentals, purchases, addons, foreign services and expired offers do not qualify',()=>{
 const opts=[offer('netflix',['ces'],{type:'rent'}),offer('netflix',['ces'],{type:'buy'}),offer('hbo',['ces'],{addon:{id:'x'}}),offer('hbo',['ces'],{expiresOn:epoch-1}),offer('other',['ces'])];
 const v=normalizeShow(show(opts),'movie',1,now);assert.equal(v.offers.length,0);assert.equal(matches(v,['netflix','hbo'],'cs-sk'),false);
});
test('unknown is not no, and never satisfies a strict language filter',()=>{
 const v=normalizeShow(show([offer('netflix',[])]),'movie',1,now);assert.equal(summarize(v,['netflix'])[0].known,false);assert.equal(matches(v,['netflix'],'cs-sk'),false);assert.equal(matches(v,['netflix'],'any'),true);
});
test('Czech or Slovak accepts either language, but Slovak requires Slovak',()=>{
 const v=normalizeShow(show([offer('netflix',['cze'])]),'movie',1,now);assert.equal(matches(v,['netflix'],'cs-sk'),true);assert.equal(matches(v,['netflix'],'sk'),false);
});
test('response identity guards movie/TV IDs',()=>{assert.throws(()=>normalizeShow(show([],2),'movie',1,now));assert.throws(()=>normalizeShow(show([],1,'tv'),'movie',1,now));});
test('numeric tmdbId responses are accepted only with matching showType',()=>{const raw=show([offer('netflix',['ces'])]);raw.tmdbId='1';assert.ok(normalizeShow(raw,'movie',1,now));assert.throws(()=>normalizeShow(raw,'tv',1,now));});
test('links require HTTPS and the exact provider domain',()=>{assert.equal(safeLink('javascript:alert(1)','netflix'),'');assert.equal(safeLink('https://netflix.com.attacker.test/','netflix'),'');assert.equal(safeLink('https://user@www.netflix.com/a','netflix'),'');assert.ok(safeLink('https://www.netflix.com/title/1','netflix'));});
test('unconfigured does not make requests or read cached language claims',async()=>{const c=createClient({fetcher:()=>{throw Error('network not permitted');}});assert.equal((await c.get('movie',1)).status,'unconfigured');});
test('same title coalesces requests, caches by type/region and never puts key in URL',async()=>{
 let calls=0;const storage=memory(),c=createClient({clock:()=>now,storage,fetcher:async(url,options)=>{
  calls++;assert.equal(new URL(url).searchParams.get('country'),'cz');assert.ok(!url.includes('test-only-key'));assert.equal(options.headers['X-API-Key'],'test-only-key');
  const tmdb=decodeURIComponent(new URL(url).pathname.split('/shows/')[1]),[type,id]=tmdb.split('/');return response(show([offer('netflix',['ces'])],Number(id),type));
 }});c.setKey('test-only-key');await Promise.all([c.get('movie',1),c.get('movie',1)]);await c.get('movie',1);assert.equal(calls,1);await c.get('tv',1);assert.equal(calls,2);assert.ok(!storage.getItem('filmRandeAudioCacheV1').includes('test-only-key'));
});
test('empty cache and expired offers are refreshed or removed',async()=>{
 let time=now,calls=0;const c=createClient({clock:()=>time,fetcher:async()=>{calls++;return response(show([offer('netflix',['ces'],{expiresOn:epoch+30})]));}});c.setKey('test');await c.get('movie',1);time+=31000;assert.equal(matches(await c.get('movie',1),['netflix'],'cs'),false);assert.equal(calls,1);time+=7*60*60*1000;await c.get('movie',1);assert.equal(calls,2);
});
test('quota error blocks queued requests, including after ordinary cancellation',async()=>{
 let calls=0;const c=createClient({clock:()=>now,fetcher:async()=>{calls++;return response({},429);}});c.setKey('test');await assert.rejects(c.get('movie',1),/počet dotazů/);c.cancel();await assert.rejects(c.get('movie',2),/počet dotazů/);assert.equal(calls,1);
});
test('404 is unknown and cached, not a proof of no dubbing',async()=>{const c=createClient({fetcher:async()=>response({},404)});c.setKey('test');const result=await c.get('movie',1);assert.equal(result.status,'missing');assert.equal(matches(result,['netflix'],'cs'),false);});
test('RapidAPI keys are routed only to RapidAPI, source caches are isolated',async()=>{
 const urls=[],c=createClient({fetcher:async(url,options)=>{urls.push(url);if(url.includes('rapidapi')){assert.equal(options.headers['X-RapidAPI-Key'],'rapid-test');assert.equal(options.headers['X-API-Key'],undefined);}return response(show([]));}});c.setKey('direct-test');await c.get('movie',1);c.setKey('rapid-test','rapid');await c.get('movie',1);assert.equal(urls.length,2);assert.ok(urls[1].startsWith('https://streaming-availability.p.rapidapi.com/'));
});
test('at most three in-flight audio requests',async()=>{
 let active=0,peak=0;const c=createClient({fetcher:async url=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;const id=Number(decodeURIComponent(new URL(url).pathname.split('/shows/')[1]).split('/')[1]);return response(show([],id));}});c.setKey('test');await Promise.all(Array.from({length:10},(_,i)=>c.get('movie',i+1)));assert.equal(peak,3);
});
test('disconnection invalidates in-flight responses even if fetch ignores abort',async()=>{
 let release,started;const ready=new Promise(resolve=>started=resolve);
 const c=createClient({fetcher:()=>new Promise(resolve=>{release=()=>resolve(response(show([offer('netflix',['ces'])])));started();})});
 c.setKey('test');const task=c.get('movie',1);const rejected=assert.rejects(task,/zrušeno/);
 await ready;c.clear();release();await rejected;assert.equal(c.peek('movie',1),null);
});
