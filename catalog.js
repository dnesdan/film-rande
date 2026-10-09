/* Solo catalogue + audio UI. Loaded before app.js; init runs after the core is ready. */
'use strict';
const FilmCatalog = (() => {
  let sessionStore=null;
  try{sessionStore=globalThis.sessionStorage;}catch{}
  const client=FilmAudioAPI.createClient({storage:sessionStore});
  const solo={seq:0,busy:false,page:0,totalPages:1,total:0,checked:0,unknown:0,settings:null,items:[],view:'grid'};
  let observer=null,pendingFilter=null,detailAudioSeq=0;
  const labels={any:'Libovolný zvuk',cs:'Český zvuk',sk:'Slovenský zvuk','cs-sk':'Český nebo slovenský zvuk'};
  function services(s) {
    const meta=state.meta[s.mediaType]||{};
    return [['netflix',meta.netflix],['hbo',meta.max]].filter(([,p])=>p&&s.providers.includes(p.provider_id)).map(([id])=>id);
  }
  function currentSettings() {return state.settings||getSettings();}
  function audioSettings() {
    const audio=$('audioFilter').value||'any';
    if(audio!=='any'&&!client.enabled())throw new Error('Pro filtr dabingu připoj jeho zdroj přes tlačítko „Dabing“. Samotný TMDb klíč zvukové stopy neposkytuje.');
    return {audio};
  }
  function compactInfo(info,ids) {
    if(info.status==='unconfigured')return '<span class="audio-tag">CZ/SK zvuk neověřen</span>';
    if(info.status==='missing')return '<span class="audio-tag">Zdroj zvuku tento titul nezná</span>';
    return FilmAudioAPI.summarize(info,ids).map(o=> {
      const cs=o.languages.includes('cs'),sk=o.languages.includes('sk');
      const text=cs&&sk?'CZ + SK zvuk':cs?'CZ zvuk':sk?'SK zvuk':!o.available?'nabídka nepotvrzena':o.known?'CZ/SK neuveden':'zvuk neověřen';
      return `<span class="audio-tag${cs||sk?' confirmed':''}">${htm(o.name)} · ${text}</span>`;
    }).join('');
  }
  async function paintAudio(el,m,type,s,detail=false) {
    if(!el)return;
    const ids=services(s),stamp=Symbol();el._audioStamp=stamp;
    el.innerHTML=client.enabled()?'<span class="audio-tag">Ověřuji zvukové stopy…</span>':'<span class="audio-tag">CZ/SK zvuk neověřen</span>';
    try{
      const info=await client.get(type,Number(m.id));
      if(!el.isConnected||el._audioStamp!==stamp||!state.connected)return;
      if(!detail){el.innerHTML=compactInfo(info,ids);return;}
      const rows=FilmAudioAPI.summarize(info,ids).map(o=> {
        const text=o.languages.filter(l=>l==='cs'||l==='sk').map(l=>l==='cs'?'Český zvuk':'Slovenský zvuk').join(' + ')||
          (info.status==='unconfigured'?'Zdroj zvuku není připojen':info.status==='missing'?'Titul není ve zdroji zvuku':!o.available?'Nabídka není tímto zdrojem potvrzena':o.known?'Český ani slovenský zvuk není v dodaném seznamu':'Zvukové stopy nejsou ověřené');
        return `<div class="audio-detail-row"><div><strong>${htm(o.name)}</strong><small>${htm(text)}</small></div>${o.link?`<a href="${htm(o.link)}" target="_blank" rel="noopener noreferrer">Přejít na službu ↗</a>`:''}</div>`;
      }).join('');
      const when=info.checkedAt?`Načteno ${new Intl.DateTimeFormat('cs-CZ',{dateStyle:'short',timeStyle:'short'}).format(info.checkedAt)}. `:'';
      el.innerHTML=`<h3>Dabing / jazyk zvuku v Česku</h3>${rows}<p class="small-note">${htm(when)}CZ/SK zvuk zahrnuje dabing i původní zvuk. Titulky se nepočítají. ${type==='tv'?'Jde o údaj pro seriál; konkrétní řady a epizody mohou mít jiné stopy. ':''}Chybějící údaj neznamená, že dabing neexistuje.</p>${!client.enabled()?'<button type="button" class="btn btn-ghost" data-audio-settings>Připojit zdroj dabingu</button>':'<a class="card-link" href="https://www.movieofthenight.com/about/api" target="_blank" rel="noopener noreferrer">Zdroj: Streaming Availability API ↗</a>'}`;
    }catch(err){
      if(el.isConnected&&el._audioStamp===stamp)el.innerHTML=`<span class="audio-tag">Zvuk neověřen</span><p class="small-note">${htm(err.message)}</p>`;
    }
  }
  async function filterAudio(items,s,isCurrent=()=>true,progress=()=>{}) {
    if(s.audio==='any')return {items,checked:0,unknown:0};
    if(!client.enabled())throw new Error('Nejprve připoj zdroj dabingu.');
    const ids=services(s),out=[];let checked=0,unknown=0;
    // Do not enqueue a whole catalogue: only three in-flight requests, bounded by one page.
    for(let i=0;i<items.length;i+=3){
      if(!isCurrent())return {items:[],checked,unknown};
      const part=items.slice(i,i+3);
      const infos=await Promise.all(part.map(m=>client.get(s.mediaType,Number(m.id))));
      if(!isCurrent())return {items:[],checked,unknown};
      infos.forEach((info,j)=>{
        checked++;
        const rows=FilmAudioAPI.summarize(info,ids);
        const matched=FilmAudioAPI.matches(info,ids,s.audio);
        if(!matched&&(info.status!=='ok'||rows.some(r=>!r.known)))unknown++;
        if(matched)out.push(part[j]);
      });
      progress(checked,items.length);
    }
    return {items:out,checked,unknown};
  }
  function score(m) {
    const votes=Math.max(0,Number(m.vote_count)||0),rating=Number(m.vote_average)||0;
    // Bayesian shrinkage: a single 10/10 is not stronger evidence than thousands of votes.
    return (votes*rating+80*6.5)/(votes+80)+Math.min(1,Math.log1p(Math.max(0,Number(m.popularity)||0))/8);
  }
  function sortItems(items,order) {
    const copy=[...items],tie=(a,b)=>Number(a.id)-Number(b.id);
    return copy.sort((a,b)=>{
      let delta=0;
      if(order==='rating')delta=(Number(b.vote_average)||0)-(Number(a.vote_average)||0);
      else if(order==='popular')delta=(Number(b.popularity)||0)-(Number(a.popularity)||0);
      else if(order==='newest')delta=releaseOf(b).localeCompare(releaseOf(a));
      else if(order==='title')delta=titleOf(a).localeCompare(titleOf(b),'cs');
      else delta=score(b)-score(a);
      return delta||tie(a,b);
    });
  }
  function requestParams(s,page) {
    const params=discoverParams(s,page),order=$('soloOrder').value;
    params.sort_by=order==='rating'?'vote_average.desc':order==='newest'?(s.mediaType==='tv'?'first_air_date.desc':'primary_release_date.desc'):'popularity.desc';
    return params;
  }
  function reason(m) {
    const votes=Number(m.vote_count)||0,rating=Number(m.vote_average)||0;
    return `Odpovídá tvým filtrům. ${rating.toFixed(1)} / 10 z ${votes.toLocaleString('cs-CZ')} hodnocení. Tip vybíráme z načtených titulů podle hodnocení, jeho spolehlivosti a popularity.`;
  }
  function renderSolo() {
    const q=$('soloQuery').value.trim().toLocaleLowerCase('cs-CZ');
    const order=$('soloOrder').value,items=sortItems(solo.items,order).filter(m=>!q||[titleOf(m),m.original_title,m.original_name].filter(Boolean).join(' ').toLocaleLowerCase('cs-CZ').includes(q));
    observer?.disconnect();
    $('soloGrid').classList.toggle('list-view',solo.view==='list');
    $('soloCount').textContent=`${items.length} ${state.mediaType==='tv'?'seriálů':'filmů'} v tomto výběru`;
    $('soloFeatured').innerHTML='';
    if(items.length&&order==='recommended'&&!q){
      const m=items[0],pic=imageUrl(m.backdrop_path||m.poster_path,'w1280');
      $('soloFeatured').innerHTML=`<article class="solo-feature"><div class="solo-feature-image">${pic?`<img src="${htm(pic)}" alt="" loading="eager">`:''}</div><div class="solo-feature-copy"><div class="eyebrow">Náš tip z tvého výběru</div><h2>${htm(titleOf(m))}</h2><p>${htm(reason(m))}</p><button class="btn btn-white" type="button" data-detail-id="${Number(m.id)}">Detail a dostupnost ↗</button></div></article>`;
    }
    $('soloGrid').innerHTML=items.map(m=> {
      const pic=imageUrl(m.poster_path,'w342');
      return `<article class="solo-tile"><button type="button" class="solo-poster" data-detail-id="${Number(m.id)}" aria-label="Detail: ${htm(titleOf(m))}">${pic?`<img src="${htm(pic)}" alt="" loading="lazy">`:''}</button><div class="solo-tile-info"><h3>${htm(titleOf(m))}</h3><div class="solo-meta">${htm(releaseOf(m).slice(0,4)||'—')} · ${(Number(m.vote_average)||0).toFixed(1)} / 10</div><p class="solo-description">${htm(m.overview||'Popis není k dispozici.')}</p><div class="audio-lines" data-solo-audio="${Number(m.id)}"><span class="audio-tag">CZ/SK zvuk neověřen</span></div><button type="button" class="solo-detail-btn" data-detail-id="${Number(m.id)}">Detail a dostupnost ↗</button></div></article>`;
    }).join('')||`<div class="solo-empty"><h3>${q?'Název není v načteném výběru.':solo.settings?.audio!=='any'?'V této části katalogu zatím bez potvrzené shody.':'Zatím tu žádný film není.'}</h3><p>${q?'Vymaž hledání nebo načti další stránku.':solo.settings?.audio!=='any'?'Neověřené jazyky nepropouštíme. Zkus načíst další tituly nebo změnit filtr zvuku.':'Uprav filtry nebo zkus načíst další tituly.'}</p></div>`;
    const hydrate=slot=>{
      const m=solo.items.find(m=>m.id===Number(slot.dataset.soloAudio));
      if(m)paintAudio(slot,m,solo.settings.mediaType,solo.settings);
    };
    if('IntersectionObserver' in globalThis){
      observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);hydrate(entry.target);}}),{rootMargin:'0px'});
      $('soloGrid').querySelectorAll('[data-solo-audio]').forEach(slot=>observer.observe(slot));
    }else $('soloGrid').querySelectorAll('[data-solo-audio]').forEach(hydrate);
    $('soloMoreBtn').disabled=solo.busy||solo.page>=solo.totalPages;
    $('soloMoreBtn').textContent=solo.page>=solo.totalPages?'Konec načteného katalogu':solo.settings?.audio!=='any'?'Prověřit další tituly':'Načíst další filmy';
    $('soloCoverage').textContent=`Načteno ${solo.page} z ${solo.totalPages} stran nabídky TMDb. ${q?`Hledání probíhá jen v ${solo.items.length} načtených titulech. `:''}${solo.settings?.audio!=='any'?`Zvuk prověřen u ${solo.checked} titulů; ${solo.unknown} vynecháno kvůli neověřenému zvuku. Neznámé údaje jazykovým filtrem neprojdou.`: 'Doporučení a abecední pořadí platí pro načtený výběr, ne pro celý katalog.'}`;
  }
  async function moreSolo() {
    if(solo.busy||!solo.settings||solo.page>=solo.totalPages)return;
    const seq=solo.seq,s=solo.settings,current=()=>seq===solo.seq&&state.connected&&state.phase==='soloScreen';
    solo.busy=true;$('soloMoreBtn').disabled=true;$('soloStopBtn').hidden=false;
    $('soloGrid').setAttribute('aria-busy','true');alertAt('soloError','');
    try{
      // At most two pages per click; never silently exhaust an API subscription.
      for(let pass=0;pass<2;pass++){
        const page=solo.page+1;
        $('soloStatus').textContent=`Načítám stranu ${page}…`;
        const result=await api(`/discover/${s.mediaType}`,requestParams(s,page));
        if(!current())return;
        const totalPages=Math.min(Math.max(1,Number(result.total_pages)||1),500);
        const candidates=(Array.isArray(result.results)?result.results:[]).filter(m=>Number.isSafeInteger(m.id)&&m.id>0&&!solo.items.some(o=>o.id===m.id));
        const filtered=await filterAudio(candidates,s,current,(n,total)=>{if(current())$('soloStatus').textContent=`Ověřuji zvuk: ${n} / ${total} titulů…`;});
        if(!current())return;
        // Only advance the page after all required verifications succeeded. Failed pages can be retried.
        solo.page=page;solo.totalPages=totalPages;solo.total=Number(result.total_results)||0;
        solo.checked+=filtered.checked;solo.unknown+=filtered.unknown;
        const unique=new Map([...solo.items,...filtered.items].map(m=>[m.id,m]));solo.items=[...unique.values()];
        state.candidates=solo.items;
        renderSolo();
        if(filtered.items.length||s.audio==='any'||solo.page>=totalPages)break;
      }
      $('soloStatus').textContent=s.audio==='any'?'Podle tvého výběru':`Jen potvrzený ${labels[s.audio].toLowerCase()}`;
    }catch(err){if(current()){$('soloStatus').textContent='Načítání se nepodařilo dokončit.';alertAt('soloError',err.message);}}
    finally{if(current()){solo.busy=false;$('soloStopBtn').hidden=true;$('soloGrid').setAttribute('aria-busy','false');$('soloMoreBtn').disabled=solo.page>=solo.totalPages;}}
  }
  function stopSolo() {
    solo.seq++;solo.busy=false;observer?.disconnect();client.cancel();
    if($('soloStopBtn')){$('soloStopBtn').hidden=true;$('soloGrid').setAttribute('aria-busy','false');$('soloMoreBtn').disabled=solo.page>=solo.totalPages;}
  }
  async function startSolo(s) {
    stopSolo();solo.settings={...s,providers:[...s.providers],genres:[...s.genres]};
    solo.page=0;solo.totalPages=1;solo.checked=0;solo.unknown=0;solo.items=[];state.candidates=[];state.settings=solo.settings;
    $('soloAudio').value=s.audio;$('soloQuery').value='';
    $('soloCriteria').textContent=[...services(s).map(id=>id==='netflix'?'Netflix':'HBO Max'),s.maxTime?`do ${s.maxTime} min`:'bez omezení délky',s.rating?`od ${s.rating} / 10`:'libovolné hodnocení',labels[s.audio]].join(' · ');
    $('soloRecommendationNote').textContent='Doporučení zohledňuje hodnocení, počet hlasů a popularitu v načteném výběru. Není to historie tvého Netflixu. Jazyky se ověřují pro Česko.';
    setScreen('soloScreen');renderSolo();await moreSolo();
  }
  async function audioBatch(s,reset,seq) {
    const current=()=>seq===state.requestSeq&&state.connected;
    let page=reset?1:state.currentPage+1;
    if(!reset&&page>state.lastTotalPages)return [];
    for(let pass=0;pass<2;pass++,page++){
      const result=await api(`/discover/${s.mediaType}`,discoverParams(s,page));
      if(!current())return [];
      const candidates=(result.results||[]).filter(m=>m.id&&!state.seen.has(`${s.mediaType}:${m.id}`));
      const filtered=await filterAudio(candidates,s,current,(n,total)=>{if(current())$('loadingSub').textContent=`Ověřuji zvuk na vybraných službách: ${n} / ${total} titulů.`;});
      if(!current())return [];
      state.currentPage=page;state.lastTotalPages=Math.min(Math.max(1,Number(result.total_pages)||1),500);
      if(filtered.items.length)return shuffle(filtered.items);
      if(page>=state.lastTotalPages)break;
    }
    throw new Error('V prověřené části katalogu zatím není potvrzený požadovaný zvuk. Neověřené tituly jsme vynechali. Změň filtry nebo zkus katalog pro jednoho, kde lze procházet další stránky.');
  }
  function openAudio() {
    // Do not stack modal dialogs: keep the new source form operable on touch devices.
    for(const d of document.querySelectorAll('dialog[open]'))if(d.id!=='audioDialog')d.close();
    if(!$('audioDialog').open)$('audioDialog').showModal();
  }
  function updateAudioHelp() {
    $('audioFilterHelp').textContent=client.enabled()?'Zvuk ověřujeme ve vybraném předplatném v Česku. Neověřené tituly filtr vynechá; ověřování čerpá API kvótu.':'Dabing i původní CZ/SK zvuk, ne titulky. Připoj vlastní klíč ke zdroji zvukových stop přes „Nastavit zdroj“.';
    $('audioSettingsBtn').textContent=client.enabled()?'Dabing ✓':'Dabing';
  }
  function forgetAudio() {
    stopSolo();client.clear();storageDel('filmRandeAudioKey');sessionDel('filmRandeAudioKey');
    $('audioKey').value='';$('audioFilter').value='any';$('soloAudio').value='any';pendingFilter=null;
    $('audioConnectionStatus').textContent='Zdroj zvuku je odpojen. Zvuk nyní uvádíme jako neověřený.';updateAudioHelp();
  }
  function init() {
    try{
      const stored=JSON.parse(sessionGet('filmRandeAudioKey')||storageGet('filmRandeAudioKey')||'null');
      if(stored?.key&&['direct','rapid'].includes(stored.source)){
        client.setKey(stored.key,stored.source);$('audioKey').value=stored.key;$('audioSource').value=stored.source;$('audioRemember').checked=!!storageGet('filmRandeAudioKey');
        $('audioConnectionStatus').textContent='Klíč zdroje zvuku je uložen. Platnost se ověří při požadavku.';
      }
    }catch{}
    solo.view=storageGet('filmRandeSoloView')==='list'?'list':'grid';updateAudioHelp();
    $('audioSettingsBtn').addEventListener('click',openAudio);
    document.addEventListener('click',e=>{if(e.target.closest('[data-audio-settings]'))openAudio();});
    $('audioForgetBtn').addEventListener('click',()=>{forgetAudio();if(state.phase==='soloScreen')startSolo({...solo.settings,audio:'any'});else queuePreview();});
    $('audioConnectForm').addEventListener('submit',async e=>{
      e.preventDefault();const value=$('audioKey').value.trim(),source=$('audioSource').value;
      $('audioConnectBtn').disabled=true;alertAt('audioError','');$('audioConnectionStatus').textContent='Ověřuji přístup pro Česko…';
      try{
        client.setKey(value,source);await client.validate();
        const saved=JSON.stringify({key:value,source});storageDel('filmRandeAudioKey');sessionDel('filmRandeAudioKey');
        $('audioRemember').checked?storageSet('filmRandeAudioKey',saved):sessionSet('filmRandeAudioKey',saved);
        $('audioConnectionStatus').textContent='Připojeno. Filtry používají pouze potvrzené zvukové stopy, ne titulky.';updateAudioHelp();
        if(pendingFilter){$('audioFilter').value=pendingFilter;$('soloAudio').value=pendingFilter;pendingFilter=null;}
        if(state.phase==='soloScreen')await startSolo({...solo.settings,audio:$('soloAudio').value});
        else queuePreview();
      }catch(err){client.setKey('');updateAudioHelp();$('audioConnectionStatus').textContent='Zdroj zvuku není připojen.';alertAt('audioError',err.message);}
      finally{$('audioConnectBtn').disabled=false;}
    });
    $('audioFilter').addEventListener('change',()=>{if($('audioFilter').value!=='any'&&!client.enabled()){pendingFilter=$('audioFilter').value;openAudio();}});
    $('soloFiltersBtn').addEventListener('click',goSetup);
    $('soloMoreBtn').addEventListener('click',moreSolo);
    $('soloStopBtn').addEventListener('click',()=>{stopSolo();$('soloStatus').textContent='Načítání zastaveno. Další stránku můžeš zkusit znovu.';});
    $('soloQuery').addEventListener('input',renderSolo);
    $('soloOrder').addEventListener('change',()=>startSolo(solo.settings));
    $('soloAudio').addEventListener('change',()=>{
      const value=$('soloAudio').value;
      if(value!=='any'&&!client.enabled()){pendingFilter=value;$('soloAudio').value=solo.settings.audio;openAudio();return;}
      $('audioFilter').value=value;startSolo({...solo.settings,audio:value});
    });
    document.querySelectorAll('[data-solo-view]').forEach(b=>{
      b.setAttribute('aria-pressed',String(b.dataset.soloView===solo.view));
      b.addEventListener('click',()=>{solo.view=b.dataset.soloView;storageSet('filmRandeSoloView',solo.view);document.querySelectorAll('[data-solo-view]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));renderSolo();});
    });
  }
  return {init,services,audioSettings,paintAudio,filterAudio,startSolo,audioBatch,stopSolo,forgetAudio,client,score,
    detail(m,type,s){
      const seq=++detailAudioSeq,el=document.createElement('section');el.className='audio-detail';$('detailContent').append(el);
      if(seq===detailAudioSeq)paintAudio(el,m,type,s,true);
    }};
})();
