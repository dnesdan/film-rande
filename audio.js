/* Streaming Availability API v4. Audio tracks are NOT TMDb spoken_languages.
 * Schema: https://docs.movieofthenight.com/resource/shows
 * This module is dependency-free and can also be tested with node:test. */
(function(root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.FilmAudioAPI = lib;
})(globalThis, function() {
  'use strict';
  const SOURCES = Object.freeze({
    direct: { base: 'https://api.movieofthenight.com/v4', header: 'X-API-Key' },
    rapid: { base: 'https://streaming-availability.p.rapidapi.com', header: 'X-RapidAPI-Key' }
  });
  const NAMES = {netflix:'Netflix', hbo:'HBO Max'};
  const TTL = 6 * 60 * 60 * 1000;
  function language(value) {
    const code = String(value || '').toLowerCase().split(/[-_]/)[0];
    return ({ces:'cs',cze:'cs',slk:'sk',slo:'sk'})[code] || code;
  }
  function safeLink(value, service) {
    try {
      const u = new URL(value), hosts = service === 'netflix' ? ['netflix.com'] : ['max.com','hbomax.com'];
      return u.protocol === 'https:' && !u.username && !u.password && hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)) ? u.href : '';
    } catch { return ''; }
  }
  function normalizeShow(show, type, id, now = Date.now()) {
    // A response from a different title/type may never supply evidence for this title.
    if (!show || ![`${type}/${id}`,String(id)].includes(String(show.tmdbId)) || show.showType !== (type==='tv'?'series':'movie'))
      throw new Error('Zdroj zvuku vrátil jiný titul nebo neočekávaný formát dat.');
    const options = show.streamingOptions?.cz;
    const offers = (Array.isArray(options) ? options : []).filter(o=>
      NAMES[o?.service?.id] && o.type === 'subscription' && !o.addon &&
      (!o.expiresOn || Number(o.expiresOn) * 1000 >= now)
    ).map(o=> {
      // Never use subtitles, original_language, spoken_languages or translated copy.
      const langs = [...new Set((Array.isArray(o.audios)?o.audios:[])
        .map(a=>language(a?.language)).filter(c=>/^[a-z]{2,3}$/.test(c)))];
      return {service:o.service.id, languages:langs, known:langs.length>0,
        link:safeLink(o.link,o.service.id), expiresOn:Number(o.expiresOn)||0};
    });
    return {status:'ok',type,id:Number(id),checkedAt:now,offers};
  }
  function summarize(info, services) {
    return services.map(service=> {
      const offers = (info?.offers||[]).filter(o=>o.service===service);
      const languages = [...new Set(offers.flatMap(o=>o.languages))];
      return {service,name:NAMES[service]||service,languages,
        known:offers.length>0&&offers.every(o=>o.known),available:offers.length>0,
        link:offers.find(o=>o.link)?.link||''};
    });
  }
  function matches(info, services, filter) {
    if (!filter || filter==='any') return true;
    const wanted = filter==='cs-sk' ? ['cs','sk'] : [filter];
    return info?.status==='ok' && summarize(info,services).some(o=>o.languages.some(l=>wanted.includes(l)));
  }
  function createClient({fetcher=globalThis.fetch.bind(globalThis), clock=Date.now, storage=null}={}) {
    let key='', source='direct', epoch=0, blockedUntil=0, blockMessage='', active=0;
    const cache=new Map(), pending=new Map(), waiters=[], controllers=new Set();
    try {
      const values=JSON.parse(storage?.getItem('filmRandeAudioCacheV1')||'[]');
      if(Array.isArray(values)) for(const [k,v] of values.slice(-120))
        if(v?.checkedAt>clock()-TTL && v.checkedAt<=clock() && Array.isArray(v.offers)) cache.set(k,v);
    } catch { /* Restricted or corrupted browser storage is not fatal. */ }
    function persist() {
      try { storage?.setItem('filmRandeAudioCacheV1',JSON.stringify([...cache].slice(-120))); } catch {}
    }
    function invalidate(resetBlock=true) {
      epoch++; if(resetBlock){blockedUntil=0; blockMessage='';}
      for(const c of controllers)c.abort();
      pending.clear();
    }
    async function limit(task) {
      await new Promise(resolve=>{if(active<3){active++;resolve();}else waiters.push(resolve);});
      try { return await task(); }
      finally {const next=waiters.shift();if(next)next();else active--;}
    }
    async function request(path,params={},generation=epoch) {
      return limit(async()=> {
        if(generation!==epoch)throw new Error('Ověření zvuku bylo zrušeno.');
        if(!key)throw new Error('Připoj zdroj dabingu pomocí jeho API klíče.');
        if(blockedUntil>clock())throw new Error(blockMessage);
        const spec=SOURCES[source],url=new URL(spec.base+path);
        for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
        const headers={Accept:'application/json',[spec.header]:key};
        if(source==='rapid')headers['X-RapidAPI-Host']='streaming-availability.p.rapidapi.com';
        const controller=new AbortController();controllers.add(controller);
        const timer=setTimeout(()=>controller.abort(),15000);
        try {
          const response=await fetcher(url.href,{headers,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
          if(generation!==epoch)throw new Error('Ověření zvuku bylo zrušeno.');
          if([401,402,403,429].includes(response.status)) {
            blockMessage=response.status===429?'Zdroj dabingu omezil počet dotazů. Zkus to později.':
              response.status===402?'Zdroj dabingu hlásí vyčerpanou kvótu nebo nepovolený tarif.':'Zdroj dabingu odmítl klíč. Ověř klíč i zvoleného poskytovatele.';
            blockedUntil=clock()+(response.status===429?60000:30*60000);
            throw new Error(blockMessage);
          }
          if(response.status===404)return null;
          if(!response.ok)throw new Error(`Zdroj dabingu není dostupný (HTTP ${response.status}).`);
          const body=await response.json();
          if(generation!==epoch)throw new Error('Ověření zvuku bylo zrušeno.');
          return body;
        } catch(err) {
          if(err.name==='AbortError')throw new Error('Ověření zvuku bylo zrušeno nebo překročilo časový limit.');
          if(err instanceof TypeError)throw new Error('Nelze připojit zdroj dabingu. Zkontroluj internet a blokování požadavků v prohlížeči.');
          throw err;
        } finally {clearTimeout(timer);controllers.delete(controller);}
      });
    }
    return {
      enabled:()=>Boolean(key),
      setKey(value,provider='direct') {
        invalidate();key=String(value||'').trim();source=SOURCES[provider]?provider:'direct';
      },
      clear() {invalidate();key='';cache.clear();persist();},
      cancel() {invalidate(false);},
      async validate() {
        const result=await request('/countries/cz');
        if(!result || result.countryCode!=='cz' || !Array.isArray(result.services))throw new Error('Zdroj dabingu nepotvrdil katalog pro Česko.');
        return result;
      },
      peek(type,id) {
        const value=cache.get(`${source}:cz:${type}/${id}`);
        // Also invalidate cached offers that have expired since retrieval.
        return value&&value.checkedAt>clock()-TTL ? {...value,offers:value.offers.filter(o=>!o.expiresOn||o.expiresOn*1000>=clock())} : null;
      },
      async get(type,id) {
        if(!['movie','tv'].includes(type)||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw new Error('Neplatný identifikátor titulu.');
        if(!key)return {status:'unconfigured',type,id:Number(id),offers:[]};
        const cached=this.peek(type,id);if(cached)return cached;
        const cacheKey=`${source}:cz:${type}/${id}`,generation=epoch;
        if(pending.has(cacheKey))return pending.get(cacheKey);
        const task=(async()=> {
          const show=await request('/shows/'+encodeURIComponent(`${type}/${id}`),{country:'cz',series_granularity:'show',output_language:'en'},generation);
          const info=show?normalizeShow(show,type,id,clock()):{status:'missing',type,id:Number(id),offers:[],checkedAt:clock()};
          if(generation!==epoch)throw new Error('Ověření zvuku bylo zrušeno.');
          cache.set(cacheKey,info);if(cache.size>120)cache.delete(cache.keys().next().value);persist();
          return info;
        })();
        pending.set(cacheKey,task);
        try{return await task;}finally{if(pending.get(cacheKey)===task)pending.delete(cacheKey);}
      }
    };
  }
  return {createClient,normalizeShow,summarize,matches,language,safeLink};
});
