'use strict';
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const $ = id => document.getElementById(id);
const allScreens = ['connectScreen','setupScreen','loadingScreen','swipeScreen','handoffScreen','resultsScreen','quickScreen','soloScreen'];
const state = {
  credential:'', connected:false, mediaType:'movie', meta:{}, mood:'any',
  candidates:[], seen:new Set(), index:0, order:[], phase:'setup', votePartner:'A', votesA:{}, votesB:{}, providerCache:new Map(),
  settings:null, quickIndex:0, quickItem:null, searchResults:[],
  currentPage:0, lastTotalPages:1, working:false, requestSeq:0, changingType:false, previewItems:[]
};

const moodGenres = {
  any: [], fun:['Comedy'], romance:['Romance'], tension:['Thriller','Mystery','Crime'],
  action:['Action','Adventure'], smart:['Science Fiction','Documentary'], horror:['Horror']
};
const htm = input => String(input ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = arr => {const copy=[...arr];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}return copy;};
const titleOf = m => m.title || m.name || m.original_title || m.original_name || 'Neznámý titul';
const releaseOf = m => m.release_date || m.first_air_date || '';
const titleId = m => `${state.mediaType}:${m.id}`;
const imageUrl = (path,size='w500') => path && /^\/[a-zA-Z0-9/_.-]+$/.test(path) ? `${IMG}${size}${path}` : '';
const tmdbLink = m => `https://www.themoviedb.org/${state.mediaType}/${encodeURIComponent(m.id)}`;
const textDate = () => new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium'}).format(new Date());

let workEpoch=0,detailRequestSeq=0;

function alertAt(id,message){const el=$(id);el.textContent=message;el.hidden=!message;}
function setScreen(name){
  allScreens.forEach(id=>$(id).hidden=id!==name);state.phase=name;
  const heading=$(name).querySelector('h1,h2');
  if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function setStatus(live,text){$('apiStatus').classList.toggle('live',live);$('statusText').textContent=text;}
function storageGet(k){try{return localStorage.getItem(k)}catch{return null}}
function storageSet(k,v){try{localStorage.setItem(k,v)}catch{}}
function storageDel(k){try{localStorage.removeItem(k)}catch{}}
function sessionGet(k){try{return sessionStorage.getItem(k)}catch{return null}}
function sessionSet(k,v){try{sessionStorage.setItem(k,v)}catch{}}
function sessionDel(k){try{sessionStorage.removeItem(k)}catch{}}
function isV3Key(key){return /^[a-f0-9]{32}$/i.test(key.trim())}
function makeQuery(obj){const params=new URLSearchParams();for(const [k,v] of Object.entries(obj || {})) if(v !== undefined && v!==null && v!=='')params.set(k,String(v));return params}

async function api(path,params={}){
  if(!state.credential)throw new Error('Chybí TMDb API klíč.');
  const controller=new AbortController();
  const options={headers:{'Accept':'application/json'},signal:controller.signal};
  const url=new URL(API+path);
  const p=makeQuery(params);p.forEach((v,k)=>url.searchParams.set(k,v));
  if(isV3Key(state.credential))url.searchParams.set('api_key',state.credential);
  else options.headers.Authorization='Bearer '+state.credential;
  let response;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try {response=await fetch(url.toString(),options)}
  catch(err){throw new Error(err.name==='AbortError'?'TMDb neodpovídá. Zkus požadavek znovu.':'Nepodařilo se připojit k TMDb. Zkontroluj internet.')}
  finally{clearTimeout(timeout)}
  let data;try{data=await response.json()}catch{data={}}
  if(!response.ok){if(response.status===401)throw new Error('TMDb odmítlo klíč/token (401). Zkontroluj API nastavení.');if(response.status===429)throw new Error('TMDb omezuje počet dotazů (429). Zkus to později.');throw new Error(data.status_message||`TMDb API chyba ${response.status}`);}
  return data;
}

// Preferuj regionálně dostupné poskytovatele. Jejich ID se načítají živě,
// nikdy nejsou natvrdo přiřazena Netflixu / HBO Maxu.
function pickProvider(items, platform){
  const normalize = name => String(name || '').replace(/[®™]/g, '').normalize('NFKC')
    .toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const rank = provider => {
    const name = normalize(provider?.provider_name);
    if(platform === 'netflix'){
      if(name === 'netflix')return 3;
      if(/^netflix (standard with ads|with ads|premium)$/.test(name))return 1;
    }else{
      if(name === 'hbo max' || name === 'max')return 3;
      if(/^(hbo max|max) (standard|premium|basic)$/.test(name))return 1;
    }
    return 0;
  };
  const cz = p => Object.prototype.hasOwnProperty.call(p?.display_priorities || {}, 'CZ') ? 10 : 0;
  return (Array.isArray(items) ? items : [])
    .filter(p => Number.isInteger(p?.provider_id) && p.provider_id > 0 && rank(p) > 0)
    .sort((a,b) => cz(b) + rank(b) - cz(a) - rank(a))[0] || null;
}

async function loadMeta(type){
  if(state.meta[type])return state.meta[type];
  // Globální seznam je stabilnější pro identifikaci názvů/ID. CZ dostupnost
  // ověřujeme podle display_priorities, regionálního seznamu a případně discover.
  const [providers,genresCz,genresEn] = await Promise.all([
    api(`/watch/providers/${type}`,{language:'en-US'}),
    api(`/genre/${type}/list`,{language:'cs-CZ'}),
    api(`/genre/${type}/list`,{language:'en-US'})
  ]);
  const all = Array.isArray(providers.results) ? providers.results : [];
  const inCz = all.filter(p => Object.prototype.hasOwnProperty.call(p?.display_priorities || {}, 'CZ'));
  let netflix = pickProvider(inCz, 'netflix');
  let max = pickProvider(inCz, 'max');

  if(!netflix || !max){
    // Některé verze odpovědi display_priorities neobsahují.
    try{
      const regional = await api(`/watch/providers/${type}`,{language:'en-US',watch_region:'CZ'});
      const items = Array.isArray(regional.results) ? regional.results : [];
      if(!netflix)netflix = pickProvider(items, 'netflix');
      if(!max)max = pickProvider(items, 'max');
    }catch(err){console.warn('Regionální seznam poskytovatelů TMDb není dostupný.',err.message)}
  }

  if(!netflix || !max){
    // Poslední fallback: poskytovatele najdeme globálně, ale jeho ID přijmeme
    // teprve po ověření, že pro ČR vrací tituly zahrnuté v předplatném.
    async function verify(candidate){
      if(!candidate)return null;
      try{
        const offer=await api(`/discover/${type}`,{
          watch_region:'CZ',with_watch_providers:candidate.provider_id,
          with_watch_monetization_types:'flatrate',page:1
        });
        return (offer.total_results > 0 || offer.results?.length > 0) ? candidate : null;
      }catch{return null}
    }
    const [foundNetflix,foundMax] = await Promise.all([
      netflix || verify(pickProvider(all,'netflix')),
      max || verify(pickProvider(all,'max'))
    ]);
    netflix=foundNetflix;max=foundMax;
  }
  if(!netflix && !max){
    throw new Error(`TMDb ověřilo spojení, ale české předplatné Netflixu ani HBO Maxu se nepodařilo potvrdit (seznam má ${all.length} poskytovatelů). Zkus stránku obnovit; pokud problém trvá, zkontroluj odpověď TMDb.`);
  }
  const enGenres = new Map((genresEn.genres||[]).map(g=>[g.name.toLowerCase(),g.id]));
  const meta={netflix,max,genres:genresCz.genres||[],enGenres,date:textDate()};
  state.meta[type]=meta;
  return meta;
}

async function connect(credential,remember){
  if(state.working)return;
  state.working=true;const connectBtn=$('connectBtn');connectBtn.disabled=true;connectBtn.textContent='Připojuji…';
  alertAt('connectError','');
  try{
    state.credential=credential.trim().replace(/^Bearer\s+/i,'').replace(/\s+/g,'');state.meta={};state.providerCache=new Map();
    const meta=await loadMeta('movie');
    if(remember){storageSet('filmRandeTMDB',state.credential);sessionDel('filmRandeTMDB')}
    else{storageDel('filmRandeTMDB');sessionSet('filmRandeTMDB',state.credential)}
    state.connected=true;$('settingsBtn').hidden=false;$('searchBtn').hidden=false;
    setStatus(true,'Česko · Katalog připojen');
    await renderMeta('movie');setScreen('setupScreen');
  }catch(err){state.connected=false;alertAt('connectError',err.message||'Nepodařilo se připojit.');setStatus(false,'Nelze načíst katalog');}
  finally{state.working=false;connectBtn.disabled=false;connectBtn.innerHTML='Připojit katalog <span aria-hidden="true">→</span>'}
}

let metadataSeq=0;
async function renderMeta(type){
  const seq=++metadataSeq;
  state.changingType=true;$('startBtn').disabled=true;
  previewSeq++;clearTimeout(previewTimer);state.previewItems=[];
  try{
    const meta=await loadMeta(type);
    if(seq!==metadataSeq)return;
    state.mediaType=type;
    $('netflixCheck').disabled=!meta.netflix;$('maxCheck').disabled=!meta.max;
    if(!meta.netflix)$('netflixCheck').checked=false;
    if(!meta.max)$('maxCheck').checked=false;
    if(!$('netflixCheck').checked && !$('maxCheck').checked){
      if(meta.netflix)$('netflixCheck').checked=true;else if(meta.max)$('maxCheck').checked=true;
    }
    $('connectedProviders').textContent=`Ověřeno ${meta.date} · ${[meta.netflix?.provider_name,meta.max?.provider_name].filter(Boolean).join(' / ')}`;
    $('runtimeLabel').textContent=type==='tv'?'Délka epizody':'Délka filmu';
    const selected=$('genreSelect').value;
    $('genreSelect').innerHTML='<option value="">Všechny žánry</option>'+meta.genres.map(g=>`<option value="${Number(g.id)}">${htm(g.name)}</option>`).join('');
    $('genreSelect').value=meta.genres.some(g=>String(g.id)===selected)?selected:'';
    const yearChoice=$('sinceSelect').value;
    $('sinceSelect').innerHTML='<option value="0">Bez omezení</option>'+[0,2,5,10,20].map(offset=>{const year=new Date().getFullYear()-offset;return `<option value="${year}">${offset===0?'Letošní novinky':`Od roku ${year}`}</option>`}).join('');
    $('sinceSelect').value=[...$('sinceSelect').options].some(o=>o.value===yearChoice)?yearChoice:'0';
    syncModeCopy();queuePreview();
  }catch(err){
    if(seq!==metadataSeq)return;
    document.querySelectorAll('input[name="mediaType"]').forEach(r=>r.checked=r.value===state.mediaType);
    if(state.connected)queuePreview();
    throw err;
  }finally{if(seq===metadataSeq){state.changingType=false;$('startBtn').disabled=false}}
}

function getSettings(){
  const providers=[];const meta=state.meta[state.mediaType];
  if($('netflixCheck').checked && meta.netflix)providers.push(meta.netflix.provider_id);
  if($('maxCheck').checked && meta.max)providers.push(meta.max.provider_id);
  if(!providers.length)throw new Error('Vyber alespoň jednu dostupnou streamovací službu.');
  const moodIds=(moodGenres[state.mood]||[]).map(name=>meta.enGenres.get(name.toLowerCase())).filter(Boolean);
  const custom=Number($('genreSelect').value)||0;
  const genres=custom?[custom]:moodIds;
  return {mediaType:state.mediaType,providers,genres,year:Number($('sinceSelect').value),maxTime:Number($('runtimeSelect').value),rating:Number($('ratingSelect').value),mode:document.querySelector('input[name="playMode"]:checked')?.value||'couple',...FilmCatalog.audioSettings()};
}

function discoverParams(s,page){
  const p={language:'cs-CZ',watch_region:'CZ',with_watch_providers:s.providers.join('|'),with_watch_monetization_types:'flatrate',include_adult:'false',sort_by:'popularity.desc',page};
  if(s.genres.length)p.with_genres=s.genres.join('|');
  if(s.maxTime)p['with_runtime.lte']=s.maxTime;
  if(s.year)p[s.mediaType==='movie'?'primary_release_date.gte':'first_air_date.gte']=`${s.year}-01-01`;
  if(s.rating){p['vote_average.gte']=s.rating;p['vote_count.gte']=50;}
  return p;
}

async function discoverBatch({reset=false}={}){
  const s=state.settings;if(!s)throw new Error('Chybí filtry.');
  const seq=++state.requestSeq;
  if(s.audio!=='any')return FilmCatalog.audioBatch(s,reset,seq);
  const firstPage=reset?1:state.currentPage+1;
  if(!reset&&firstPage>state.lastTotalPages)return [];
  const first=await api(`/discover/${s.mediaType}`,discoverParams(s,firstPage));
  if(seq!==state.requestSeq)return [];
  const totalPages=Math.min(first.total_pages||1,500);
  state.lastTotalPages=totalPages;
  const pages=[firstPage];
  if(reset){
    // Směs populárních filmů + různých stran katalogu, vždy jiné vzorky.
    const pageCap=Math.min(18,totalPages);
    const choices=shuffle(Array.from({length:pageCap},(_,i)=>i+1).filter(p=>p!==firstPage));
    pages.push(...choices.slice(0,3));
  }else{
    if(firstPage<totalPages)pages.push(firstPage+1);
    if(firstPage+1<totalPages)pages.push(firstPage+2);
  }
  const later=await Promise.all(pages.slice(1).map(page=>api(`/discover/${s.mediaType}`,discoverParams(s,page)).catch(()=>({results:[]}))));
  if(seq!==state.requestSeq)return [];
  const list=[...(first.results||[]),...later.flatMap(x=>x.results||[])];
  state.currentPage=Math.min(Math.max(...pages),totalPages);
  const unique=new Map();
  for(const m of list){
    if(!m.id || !m.poster_path)continue;
    if(state.seen.has(`${s.mediaType}:${m.id}`))continue;
    unique.set(m.id,m);
  }
  return shuffle([...unique.values()]);
}

async function startGame(){
  if(state.working||state.changingType)return;
  alertAt('filterError','');
  try{state.settings=getSettings()}
  catch(err){alertAt('filterError',err.message);return}
  if(state.settings.mode==='solo')return FilmCatalog.startSolo(state.settings);
  const epoch=++workEpoch;
  state.working=true;state.currentPage=0;state.seen=new Set();state.index=0;state.votePartner='A';state.votesA={};state.votesB={};
  $('loadingTitle').textContent='Chystám váš výběr.';$('loadingSub').textContent='Načítám tituly z vašeho předplatného pro Česko.';setScreen('loadingScreen');
  try{
    const candidates=await discoverBatch({reset:true});
    if(epoch!==workEpoch||!state.connected)return;
    if(!candidates.length)throw new Error('Žádné tituly neodpovídají filtrům. Zkus nižší hodnocení, delší stopáž nebo širší výběr žánrů.');
    state.candidates=candidates.slice(0,16);state.candidates.forEach(m=>state.seen.add(titleId(m)));
    state.index=0;
    if(state.settings.mode==='quick'){state.quickIndex=0;renderQuick();setScreen('quickScreen')}
    else{state.order=state.candidates.map((_,i)=>i);renderSwipe('A');setScreen('swipeScreen')}
  }catch(err){if(epoch===workEpoch&&state.connected){alertAt('filterError',err.message);setScreen('setupScreen')}}
  finally{if(epoch===workEpoch)state.working=false}
}

function getMetaForFilm(m){
  const meta=state.meta[state.mediaType];
  const matched=(m.genre_ids||[]).map(id=>meta.genres.find(g=>g.id===id)?.name).filter(Boolean);
  const date=releaseOf(m);
  return {genres:matched.slice(0,3).join(' · '),year:date?date.slice(0,4):'?',score:(Number(m.vote_average)||0).toFixed(1),votes:m.vote_count||0};
}

function cardHTML(m){
  const v=getMetaForFilm(m),pic=imageUrl(m.backdrop_path||m.poster_path,'w1280');
  return `<div class="poster-side">${pic?`<img src="${htm(pic)}" alt="" loading="eager">`:'<div class="poster-missing"></div>'}</div>
  <div class="movie-info"><div class="movie-kicker">${state.mediaType==='tv'?'Seriál':'Film'} / ${htm(v.genres||'Váš večerní výběr')}</div>
    <h2 class="movie-title">${htm(titleOf(m))}</h2>
    <div class="meta-row"><span class="meta-chip">${htm(v.year)}</span><span class="meta-chip rating">${htm(v.score)} / 10</span><span class="meta-chip">${Number(v.votes).toLocaleString('cs-CZ')} hodnocení</span></div>
    <p class="synopsis">${htm(m.overview||'Popis tohoto titulu zatím není k dispozici.')}</p>
    <div class="movie-bottom"><div class="provider-badges" data-provider-slot="${Number(m.id)}"><span class="provider-pill">Ověřuji dostupnost…</span></div>
      <div class="audio-lines" data-audio-slot="${Number(m.id)}"></div>
      <div class="movie-links"><button class="btn btn-white" type="button" data-detail-id="${Number(m.id)}">Detail a dostupnost <span aria-hidden="true">↗</span></button><a class="card-link" href="${htm(tmdbLink(m))}" target="_blank" rel="noopener noreferrer">Na TMDb ↗</a></div>
    </div>
  </div>`;
}

function selectedProviderIds(){
  const meta=state.meta[state.mediaType];
  if(!meta)return [];
  return [(meta.netflix && $('netflixCheck').checked ? meta.netflix.provider_id : null),(meta.max && $('maxCheck').checked ? meta.max.provider_id : null)].filter(Boolean);
}

async function watchInfo(m){
  const key=titleId(m);
  if(!state.providerCache.has(key)){
    const task=api(`/${state.mediaType}/${m.id}/watch/providers`).then(resp=>resp.results?.CZ||{}).catch(err=>{state.providerCache.delete(key);throw err});
    state.providerCache.set(key,task);
  }
  return state.providerCache.get(key);
}

function renderCard(container,m){
  const el=$(container);el.innerHTML=cardHTML(m);
  const slot=el.querySelector('[data-provider-slot]');
  FilmCatalog.paintAudio(el.querySelector('[data-audio-slot]'),m,state.mediaType,{mediaType:state.mediaType,providers:selectedProviderIds()});
  watchInfo(m).then(cz=>{
    if(!slot?.isConnected)return;
    const selected=selectedProviderIds();
    const services=(cz.flatrate||[]).filter(p=>selected.includes(p.provider_id));
    slot.innerHTML=services.length?services.map(p=>`<span class="provider-pill">${htm(p.provider_name)}</span>`).join(''):'<span class="provider-pill">Dostupnost se mohla změnit</span>';
  }).catch(()=>{if(slot?.isConnected)slot.innerHTML='<span class="provider-pill">Ověř v detailu</span>'});
}

function renderSwipe(partner){
  const n=state.index;
  const m=state.candidates[state.order[n]];
  const count=state.candidates.length;
  $('gameEyebrow').textContent=partner==='A'?'01 / Tvůj výběr':'02 / Její výběr';
  $('gameTitle').textContent=partner==='A'?'Teď vybíráš ty.':'Teď vybírá tvoje paní.';
  $('gameSubtitle').textContent=partner==='A'?'Tvoje volby zůstanou tajné.':'Bez nápovědy, ať je to fér.';
  $('progressText').textContent=`${n+1} / ${count}`;
  $('progressFill').style.width=(100*n/count)+'%';
  renderCard('swipeCard',m);
}

function vote(score){
  if(state.phase!=='swipeScreen'||state.working)return;
  const partner=state.votePartner||'A';
  const m=state.candidates[state.order[state.index]];
  const key=titleId(m);
  (partner==='A'?state.votesA:state.votesB)[key]=score;
  state.index++;
  if(state.index>=state.candidates.length){
    if(partner==='A'){setScreen('handoffScreen')}
    else{renderResults();setScreen('resultsScreen')}
  } else renderSwipe(partner);
}

function startPartnerB(){state.votePartner='B';state.index=0;state.order=shuffle(state.candidates.map((_,i)=>i));renderSwipe('B');setScreen('swipeScreen');}

function resultList(){
  return state.candidates.map(m=>({movie:m,a:state.votesA[titleId(m)]??0,b:state.votesB[titleId(m)]??0})).filter(x=>x.a>0&&x.b>0).sort((x,y)=>((y.a+y.b)-(x.a+x.b)) || ((y.movie.vote_average||0)-(x.movie.vote_average||0)));
}

function renderResults(){
  const matches=resultList(),strong=matches.filter(x=>x.a===2&&x.b===2);
  $('resultEmoji').textContent=`Společných tipů: ${matches.length}`;
  $('resultTitle').textContent=matches.length?'Na tomhle se shodnete.':'Dnes to ještě neklaplo.';
  $('resultSummary').textContent=matches.length?`Oba jste dali ano u ${strong.length} titulů. Zbývá vybrat, který pustíte jako první.`:'Zkuste jinou náladu nebo další výběr. Filmy, které někdo odmítl, sem nepouštíme.';
  $('resultsGrid').innerHTML=matches.length?matches.slice(0,12).map(({movie:m,a,b})=>{
    const v=getMetaForFilm(m),pic=imageUrl(m.poster_path,'w500');
    return `<article class="result-card"><div class="result-cover">${pic?`<img src="${htm(pic)}" alt="Plakát: ${htm(titleOf(m))}" loading="lazy">`:''}<span class="result-badge">${a===2&&b===2?'OBA CHCETE VIDĚT':'SPOLEČNÝ KOMPROMIS'}</span></div><div class="result-body"><h3 class="result-title">${htm(titleOf(m))}</h3><div class="result-detail">${htm(v.year)} · ${htm(v.score)} / 10</div><div class="audio-lines" data-result-audio="${Number(m.id)}"></div><p class="result-description">${htm(m.overview||'Popis není k dispozici.')}</p><button class="btn btn-ghost" type="button" data-detail-id="${Number(m.id)}">Kde sledovat ↗</button></div></article>`;
  }).join(''):'<div class="no-matches" style="grid-column:1/-1"><h3>Ještě jedno kolo?</h3><p class="lede">Jiný výběr může sednout lépe. Zkus další tituly nebo uvolni filtry.</p></div>';
  for(const {movie:m} of matches.slice(0,12))FilmCatalog.paintAudio($('resultsGrid').querySelector(`[data-result-audio="${Number(m.id)}"]`),m,state.mediaType,state.settings);
}

function renderQuick(){
  if(!state.candidates.length)return;
  state.quickItem=state.candidates[state.quickIndex%state.candidates.length];
  renderCard('quickCard',state.quickItem);
}
function nextQuick(){state.quickIndex=(state.quickIndex+1)%state.candidates.length;renderQuick()}

async function loadMore(){
  if(state.working)return;
  const epoch=++workEpoch;
  state.working=true;
  $('loadingTitle').textContent='Další filmy na obzoru.';$('loadingSub').textContent='Čtu další části aktuálního katalogu.';setScreen('loadingScreen');
  try{
    // Pro další párování se nejprve využije další strana, případně nová kombinace stran.
    let candidates=await discoverBatch({reset:false});
    if(epoch!==workEpoch||!state.connected)return;
    if(!candidates.length){state.currentPage=0;candidates=await discoverBatch({reset:true})}
    if(epoch!==workEpoch||!state.connected)return;
    if(!candidates.length)throw new Error('V aktuálním vzorku katalogu už žádné nové tituly nejsou. Změň filtry.');
    state.candidates=candidates.slice(0,16);state.candidates.forEach(m=>state.seen.add(titleId(m)));
    state.votesA={};state.votesB={};state.index=0;state.votePartner='A';
    if(state.settings.mode==='quick'){state.quickIndex=0;renderQuick();setScreen('quickScreen')}
    else{state.order=state.candidates.map((_,i)=>i);renderSwipe('A');setScreen('swipeScreen')}
  }catch(err){if(epoch===workEpoch&&state.connected){alertAt('filterError',err.message);setScreen('setupScreen')}}
  finally{if(epoch===workEpoch)state.working=false}
}

async function showDetail(movie){
  if(!movie)return;
  const dialog=$('detailDialog'),seq=++detailRequestSeq;
  const detailSettings={mediaType:state.mediaType,providers:selectedProviderIds()};
  $('detailTitle').textContent=titleOf(movie);
  $('detailContent').innerHTML='<p>Ověřuji dostupnost v Česku a podrobnosti…</p>';
  if(!dialog.open)dialog.showModal();
  try{
    const kind=state.mediaType;
    const [cz,detail]=await Promise.all([
      watchInfo(movie),
      api(`/${kind}/${movie.id}`,{language:'cs-CZ'}).catch(()=>movie)
    ]);
    if(seq!==detailRequestSeq||!dialog.open||kind!==state.mediaType||!state.connected)return;
    // Vypisujeme výhradně předplatné, nikoli půjčovné / nákup.
    const flatrate=cz?.flatrate||[];
    const filtered=flatrate.filter(p=>detailSettings.providers.includes(p.provider_id));
    const v=getMetaForFilm(movie);
    const runtime=kind==='movie'?detail.runtime:(detail.episode_run_time||[])[0];
    const backdrop=imageUrl(detail.backdrop_path||movie.backdrop_path,'w780');
    const providerText=filtered.length?filtered.map(p=>`<span class="provider-pill">${htm(p.provider_name)}</span>`).join(''):'<span style="color:#ffd3a8">Momentálně není potvrzené předplatné na vybraných platformách. Katalog se mohl změnit.</span>';
    const official=cz?.link && /^https:\/\//i.test(cz.link)?cz.link:tmdbLink(movie);
    $('detailContent').innerHTML=`${backdrop?`<div class="detail-backdrop"><img src="${htm(backdrop)}" alt="${htm(titleOf(movie))}"></div>`:''}
      <p class="detail-note">${htm(detail.overview||movie.overview||'Bez anotace.')}</p>
      <div class="mini-info"><span>${htm(v.year)}</span><span>${htm(v.score)} / 10</span>${runtime?`<span>${Number(runtime)} min ${kind==='tv'?'(epizoda)':''}</span>`:''}</div>
      <h3 style="margin-top:21px;font-size:16px">Dostupné v českém předplatném</h3><div class="provider-badges">${providerText}</div>
      <p class="detail-note">Aktuálnost dat zajišťuje TMDb/JustWatch. Odkaz vede na přehled nabídek, nikoli nutně rovnou do aplikace.</p>
      <a href="${htm(official)}" class="btn btn-primary btn-block" target="_blank" rel="noopener noreferrer">Zobrazit nabídky přehrání ↗</a>
      <a href="${htm(tmdbLink(movie))}" class="card-link" target="_blank" rel="noopener noreferrer" style="margin-top:14px">Detail filmu/seriálu na TMDb ↗</a>`;
    FilmCatalog.detail(movie,kind,detailSettings);
  }catch(err){if(seq!==detailRequestSeq||!dialog.open)return;$('detailContent').innerHTML=`<div class="error">${htm(err.message)}</div><p><a href="${htm(tmdbLink(movie))}" target="_blank" rel="noopener noreferrer">Otevřít na TMDb ↗</a></p>`}
}

async function searchTitles(term){
  const q=term.trim();if(!q)return;
  $('searchResults').innerHTML='<p class="detail-note">Hledám v katalogu…</p>';
  try{
    const media=state.mediaType;
    const res=await api(`/search/${media}`,{query:q,language:'cs-CZ',page:1,include_adult:false});
    const items=(res.results||[]).slice(0,8);state.searchResults=items;
    if(!items.length){$('searchResults').innerHTML='<p class="detail-note">Žádné výsledky. Zkus jiný název.</p>';return}
    $('searchResults').innerHTML=items.map((m,i)=>{const pic=imageUrl(m.poster_path,'w185');return `<article class="search-result">${pic?`<img src="${htm(pic)}" alt="" loading="lazy">`:'<span class="search-placeholder" aria-hidden="true"></span>'}<div class="search-desc"><strong>${htm(titleOf(m))}</strong><small>${htm(releaseOf(m).slice(0,4))} · ${(Number(m.vote_average)||0).toFixed(1)} / 10</small></div><button type="button" data-search-idx="${i}" class="btn btn-ghost">Dostupnost ↗</button></article>`}).join('');
  }catch(err){$('searchResults').innerHTML=`<div class="error">${htm(err.message)}</div>`}
}

function goSetup(){workEpoch++;state.requestSeq++;state.working=false;FilmCatalog.stopSolo();state.votePartner='A';setScreen('setupScreen');syncModeCopy();queuePreview()}
function disconnect(){if(!confirm('Odpojit katalogy a odstranit oba uložené API klíče z tohoto prohlížeče?'))return;workEpoch++;detailRequestSeq++;state.requestSeq++;state.working=false;FilmCatalog.forgetAudio();previewSeq++;metadataSeq++;clearTimeout(previewTimer);state.previewItems=[];state.candidates=[];state.votesA={};state.votesB={};state.credential='';state.connected=false;state.meta={};state.providerCache=new Map();storageDel('filmRandeTMDB');sessionDel('filmRandeTMDB');$('settingsBtn').hidden=true;$('searchBtn').hidden=true;$('tokenInput').value='';setStatus(false,'Katalog není připojen');setScreen('connectScreen')}
function closeDialog(id){$(id).close()}

$('connectForm').addEventListener('submit',e=>{e.preventDefault();connect($('tokenInput').value,$('rememberKey').checked)});
$('toggleKey').addEventListener('click',()=>{const input=$('tokenInput');input.type=input.type==='password'?'text':'password';$('toggleKey').textContent=input.type==='password'?'Ukázat':'Skrýt';$('toggleKey').setAttribute('aria-pressed',String(input.type!=='password'))});
document.querySelectorAll('input[name="mediaType"]').forEach(r=>r.addEventListener('change',async e=>{
  if(!e.target.checked)return;
  try{await renderMeta(e.target.value);alertAt('filterError','')}
  catch(err){alertAt('filterError',err.message)}
}));
$('moodChips').addEventListener('click',e=>{const chip=e.target.closest('[data-mood]');if(!chip)return;state.mood=chip.dataset.mood;document.querySelectorAll('[data-mood]').forEach(b=>b.setAttribute('aria-pressed',String(b===chip)));queuePreview()});
$('filterForm').addEventListener('submit',e=>{e.preventDefault();startGame()});
document.querySelectorAll('[data-score]').forEach(btn=>btn.addEventListener('click',()=>vote(Number(btn.dataset.score))));
$('handoffBtn').addEventListener('click',startPartnerB);
$('backToFiltersBtn').addEventListener('click',goSetup);
$('resultFiltersBtn').addEventListener('click',goSetup);
$('quickFiltersBtn').addEventListener('click',goSetup);
$('againBtn').addEventListener('click',loadMore);
$('nextQuickBtn').addEventListener('click',nextQuick);
$('moreQuickBtn').addEventListener('click',loadMore);
$('watchQuickBtn').addEventListener('click',()=>showDetail(state.quickItem));
$('aboutBtn').addEventListener('click',()=>$('aboutDialog').showModal());
$('searchBtn').addEventListener('click',()=>$('searchDialog').showModal());
$('settingsBtn').addEventListener('click',disconnect);
$('searchForm').addEventListener('submit',e=>{e.preventDefault();searchTitles($('searchInput').value)});
$('homeLink').addEventListener('click',e=>{e.preventDefault();state.connected?goSetup():setScreen('connectScreen')});
document.querySelectorAll('[data-close-dialog]').forEach(btn=>btn.addEventListener('click',()=>closeDialog(btn.dataset.closeDialog)));
document.addEventListener('click',e=>{
  const watch=e.target.closest('[data-detail-id]');
  if(watch){const id=Number(watch.dataset.detailId);const movie=state.candidates.find(m=>m.id===id)||state.searchResults.find(m=>m.id===id)||state.previewItems.find(m=>m.id===id);showDetail(movie);}
  const searched=e.target.closest('[data-search-idx]');
  if(searched){const movie=state.searchResults[Number(searched.dataset.searchIdx)];if(movie){$('searchDialog').close();showDetail(movie)}}
});
document.addEventListener('keydown',e=>{
  if(e.repeat||state.phase!=='swipeScreen'||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(e.key==='ArrowLeft'||e.key==='1'){e.preventDefault();vote(0)}
  if(e.key==='ArrowUp'||e.key==='2'){e.preventDefault();vote(1)}
  if(e.key==='ArrowRight'||e.key==='3'){e.preventDefault();vote(2)}
});
// Dotykové gesto funguje i na mobilu, ale jen s dostatečným horizontálním pohybem.
let touchStart=null;
$('swipeCard').addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
$('swipeCard').addEventListener('touchend',e=>{if(!touchStart)return;const x=e.changedTouches[0].clientX-touchStart.x,y=e.changedTouches[0].clientY-touchStart.y;touchStart=null;if(Math.abs(x)>90&&Math.abs(x)>Math.abs(y)*1.8)vote(x>0?2:0)},{passive:true});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});


// Catalogue previews are independent of the private voting round. Stale responses
// may not replace a newer filter selection, and no film data is bundled here.
let previewTimer=null,previewSeq=0;
function syncModeCopy(){
  const mode=document.querySelector('input[name="playMode"]:checked')?.value,quick=mode==='quick',solo=mode==='solo';
  $('startBtn').innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'+(solo?'Zobrazit můj výběr':quick?'Najít rychlý tip':state.mediaType==='tv'?'Najít náš seriál':'Najít náš film');
  $('modeHelp').textContent=solo?'Seznam titulů, doporučení, řazení a další stránky. Bez hlasování.':quick?'Jeden tip za druhým. Bez hlasování.':'Až 16 titulů. Dva soukromé výběry. Vaše společné shody.';
  $('setupTitle').textContent=solo?'Dobrý film. Podle tebe.':'Dobrý film. Pro oba.';
  $('setupTitle').nextElementSibling.textContent=solo?'Nastav si náladu a projdi nabídku svého předplatného.':'Vyberte náladu. Zbytek už nechte na svých hlasech.';
  document.querySelector('.preview-guide').innerHTML=solo?'<div><b>01 / Nastav výběr</b>Nálada, délka, hodnocení a zvuk.</div><div><b>02 / Projdi katalog</b>Plakáty nebo seznam. Další stránky.</div><div><b>03 / Vyber si film</b>Podrobnosti a dostupnost v jednom.</div>':'<div><b>01 / Vybereš ty</b>Ano, možná, nebo ne.</div><div><b>02 / Vybere ona</b>Stejné filmy. Bez nápovědy.</div><div><b>03 / Pustíte si film</b>Jen to, co zaujalo oba.</div>';
}
function queuePreview(){
  const seq=++previewSeq;clearTimeout(previewTimer);
  if(!state.connected)return;
  state.previewItems=[];
  $('previewGrid').setAttribute('aria-busy','true');
  $('previewGrid').innerHTML='<div class="skeleton" aria-hidden="true"></div>'.repeat(3);
  $('previewStatus').textContent='Načítám tituly podle vašeho výběru…';
  previewTimer=setTimeout(()=>loadPreview(seq),220);
}
async function loadPreview(seq){
  try{
    const settings=getSettings(),type=state.mediaType;
    if(settings.audio!=='any'){
      if(seq===previewSeq){$('previewGrid').innerHTML='';$('previewStatus').textContent='Jazykový filtr je aktivní. Spusť výběr: teprve potom ověříme zvukové stopy, aby náhled zbytečně nečerpal API kvótu.';}
      return;
    }
    const offer=await api(`/discover/${type}`,discoverParams(settings,1));
    if(seq!==previewSeq||!state.connected||type!==state.mediaType)return;
    const titles=(Array.isArray(offer.results)?offer.results:[]).filter(m=>m.id&&m.poster_path).slice(0,3);
    state.previewItems=titles;
    $('previewGrid').innerHTML=titles.map(m=>`<button type="button" class="preview-item" data-detail-id="${Number(m.id)}" aria-label="Detail: ${htm(titleOf(m))}"><div class="preview-image"><img src="${htm(imageUrl(m.poster_path,'w342'))}" alt="" loading="lazy"></div><strong>${htm(titleOf(m))}</strong><small>${htm(releaseOf(m).slice(0,4))} · ${(Number(m.vote_average)||0).toFixed(1)} / 10</small></button>`).join('');
    $('previewStatus').textContent=titles.length?'Náhled podle zvolených filtrů. Jazyky zvuku najdeš v detailu po připojení zdroje dabingu.':'Těmto filtrům žádný titul neodpovídá. Zkuste širší žánr, delší stopáž nebo nižší hodnocení.';
  }catch(err){
    if(seq!==previewSeq||!state.connected)return;
    $('previewGrid').innerHTML='';$('previewStatus').textContent=err.message||'Náhled nelze načíst. Zkuste obnovit katalog.';
  }finally{if(seq===previewSeq)$('previewGrid').setAttribute('aria-busy','false')}
}
$('refreshPreview').addEventListener('click',queuePreview);
$('filterForm').addEventListener('change',e=>{
  syncModeCopy();
  if(e.target.name!=='mediaType'&&e.target.name!=='playMode')queuePreview();
});

FilmCatalog.init();
syncModeCopy();

(function init(){
  const credential=sessionGet('filmRandeTMDB')||storageGet('filmRandeTMDB');
  if(credential){$('tokenInput').value=credential;$('rememberKey').checked=!!storageGet('filmRandeTMDB');connect(credential,!!storageGet('filmRandeTMDB'))}
})();
