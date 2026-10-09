"""Synthetic integration tests. Never uses real TMDb or streaming credentials.
Run: python tests/browser_smoke.py (local files are fulfilled in-memory; no server).
Requires playwright and Chromium (CHROMIUM_PATH can override its location).
"""
import asyncio, json, math, os, re
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from playwright.async_api import async_playwright

ROOT=Path(os.environ.get('TEST_OUTPUT',str(Path(__file__).resolve().parent/'artifacts')));ROOT.mkdir(parents=True,exist_ok=True)
BASE='https://film-rande.test'
SITE=Path(__file__).resolve().parent.parent
MOVIES=[dict(id=i,title=f'Zkušební film {i:02d}',name=f'Zkušební seriál {i:02d}',overview='Syntetický popis pro test rozhraní. Nejde o skutečný film ani o nabídku služby.',poster_path=f'/p{i}.jpg',backdrop_path=f'/b{i}.jpg',release_date=f'202{(i%6)}-03-01',first_air_date=f'202{(i%6)}-03-01',vote_average=round(6.0+(i%12)/4,2),vote_count=100+i*80,popularity=1000-i*10,genre_ids=[18],original_language='cs' if i%6==3 else 'en',runtime=100) for i in range(1,61)]
PROVIDERS=[dict(provider_id=8,provider_name='Netflix',display_priorities={'CZ':1}),dict(provider_id=999,provider_name='HBO Max',display_priorities={'CZ':2})]

def audios(i):
    n=i%6
    return (['ces'] if n in (0,4) else ['slk'] if n==5 else [] if n==2 else ['eng'], ['ces'] if n==1 else ['slo'] if n in (2,4) else ['eng'])

async def fixture(page, settings):
    calls=[];errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    async def route(r):
        u=urlparse(r.request.url);q=parse_qs(u.query);path=unquote(u.path)
        if u.hostname=='film-rande.test':
            file=SITE/('index.html' if path=='/' else path.lstrip('/'))
            if file.parent!=SITE or not file.is_file():return await r.fulfill(status=404,body='Missing fixture asset')
            mime='text/html' if file.suffix=='.html' else 'text/css' if file.suffix=='.css' else 'application/javascript'
            return await r.fulfill(status=200,content_type=mime,body=file.read_text())
        if u.hostname=='image.tmdb.org':
            number=''.join(c for c in path.split('/')[-1] if c.isdigit()) or '0'
            svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#303032"/><path d="M0 360L400 180V600H0Z" fill="#454548"/><text x="30" y="90" fill="#bbb" font-size="20">TESTOVACI PLAKAT</text><text x="30" y="535" fill="#ddd" font-size="75">{number.zfill(2)}</text></svg>'
            return await r.fulfill(status=200,content_type='image/svg+xml',body=svg)
        if u.hostname=='api.themoviedb.org':
            calls.append(('tmdb',path,q,r.request.headers))
            if settings.get('tmdb401'):return await r.fulfill(status=401,json={'status_message':'Unauthorized'})
            if '/watch/providers/' in path and path.startswith('/3/watch'):data={'results':PROVIDERS}
            elif '/genre/' in path:data={'genres':[{'id':18,'name':'Drama'},{'id':35,'name':'Comedy' if q.get('language')==['en-US'] else 'Komedie'}]}
            elif '/discover/' in path:
                if settings.get('delay'):await asyncio.sleep(settings['delay'])
                items=[dict(m) for m in MOVIES]
                if settings.get('empty'):items=[]
                rating=float(q.get('vote_average.gte',['0'])[0]);items=[m for m in items if m['vote_average']>=rating]
                sort=q.get('sort_by',[''])[0]
                if sort=='vote_average.desc':items.sort(key=lambda x:x['vote_average'],reverse=True)
                elif sort in ['primary_release_date.desc','first_air_date.desc']:items.sort(key=lambda x:x['release_date'],reverse=True)
                p=int(q.get('page',['1'])[0]);data={'results':items[(p-1)*20:p*20],'total_pages':math.ceil(len(items)/20),'total_results':len(items)}
            elif path.endswith('/watch/providers'):data={'results':{'CZ':{'flatrate':PROVIDERS,'link':'https://www.themoviedb.org/movie/1/watch?locale=CZ'}}}
            elif '/search/' in path:data={'results':MOVIES[:3]}
            else:
                mid=int(path.split('/')[-1]);data={**MOVIES[mid-1],'episode_run_time':[42]}
            return await r.fulfill(status=200,json=data)
        if u.hostname in ['api.movieofthenight.com','streaming-availability.p.rapidapi.com']:
            calls.append(('audio',path,q,r.request.headers))
            if path.endswith('/countries/cz'):data={'countryCode':'cz','services':[{'id':'netflix'},{'id':'hbo'}]}
            else:
                if settings.get('audio429'):return await r.fulfill(status=429,json={'message':'quota'})
                kind,mid=path.split('/shows/')[1].split('/');i=int(mid);nl,hl=audios(i)
                def opt(service,langs,typ='subscription'):
                    return {'service':{'id':service},'type':typ,'audios':[{'language':x} for x in langs],'subtitles':[{'locale':{'language':'ces'}}],'link':'https://www.netflix.com/title/1' if service=='netflix' else 'https://play.hbomax.com/movie/1'}
                data={'tmdbId':f'{kind}/{i}','showType':'series' if kind=='tv' else 'movie','streamingOptions':{'cz':[opt('netflix',nl),opt('hbo',hl),opt('netflix',['ces'],'rent')],'sk':[opt('netflix',['ces'])]}}
            return await r.fulfill(status=200,json=data)
        # No external network, telemetry, or real provider accounts during testing.
        await r.fulfill(status=200,content_type='image/svg+xml',body='<svg xmlns="http://www.w3.org/2000/svg"/>')
    async def bridge(url,options):
        class MockRoute:
            def __init__(self):
                self.request=SimpleNamespace(url=url,headers={k.lower():v for k,v in options.get('headers',{}).items()})
                self.result=None
            async def fulfill(self,status=200,json=None,body=None,**kwargs):
                self.result={'status':status,'data':json if json is not None else {}}
        r=MockRoute();await route(r);return r.result
    await page.expose_function('__mockFetch',bridge)
    return calls,errors

async def load_page(page):
    html=(SITE/'index.html').read_text()
    html=re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
    html=re.sub(r'<script defer[^>]*></script>', '', html)
    css=(SITE/'app.css').read_text()+'\n'+(SITE/'catalog.css').read_text()
    await page.set_content(html.replace('</head>','<style>'+css+'</style></head>'))
    await page.evaluate('''() => {
        const store=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}};
        Object.defineProperty(window,'localStorage',{value:store(),configurable:true});
        Object.defineProperty(window,'sessionStorage',{value:store(),configurable:true});
        window.fetch=async(url,options={})=>{const result=await window.__mockFetch(String(url),{headers:options.headers||{}});return new Response(JSON.stringify(result.data),{status:result.status,headers:{'Content-Type':'application/json'}})};
    }''')
    for name in ['audio.js','catalog.js','app.js']:
        content=(SITE/name).read_text()
        if name=='app.js':
            # Test-only poster double: no blocked or real image requests in this environment.
            replacement="const imageUrl = (path,size='w500') => 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 600'><rect width='400' height='600' fill='#303032'/><path d='M0 360L400 180V600H0Z' fill='#454548'/><text x='30' y='90' fill='#bbb' font-size='20'>TESTOVACI PLAKAT</text><text x='30' y='535' fill='#ddd' font-size='75'>${(path||'').replace(/[^0-9]/g,'')}</text></svg>`);"
            content=re.sub(r'^const imageUrl = .*$', lambda _:replacement, content, flags=re.M)
        await page.add_script_tag(content=content)

async def connect(page):
    await load_page(page)
    await page.locator('#tokenInput').fill('synthetic-tmdb-token')
    await page.locator('#connectBtn').click()
    await page.locator('#setupScreen').wait_for(state='visible')

async def finished(page):
    await page.wait_for_function("document.getElementById('soloGrid').getAttribute('aria-busy')==='false'")

async def dimensions(page,name):
    overflow=await page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
    assert not overflow, f'horizontal overflow {name}'
    await page.screenshot(path=str(ROOT/(name+'.png')),full_page=True)

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1440,'height':1040},device_scale_factor=1)
        page=await context.new_page();settings={};calls,errors=await fixture(page,settings)
        await connect(page)
        await dimensions(page,'setup-desktop')
        await page.locator('input[name="playMode"][value="solo"]').check(force=True)
        await page.locator('#startBtn').click();await finished(page)
        assert await page.locator('#soloGrid .solo-tile').count()==20
        assert not [c for c in calls if c[0]=='audio'], 'unconfigured audio must not call network'
        await dimensions(page,'solo-desktop')
        await page.locator('#soloMoreBtn').click();await finished(page)
        assert await page.locator('#soloGrid .solo-tile').count()==40
        ids=await page.locator('#soloGrid [data-solo-audio]').evaluate_all('(els)=>els.map(x=>x.dataset.soloAudio)')
        assert len(ids)==len(set(ids))
        await page.locator('#soloQuery').fill('film 02');assert await page.locator('#soloGrid .solo-tile').count()==1
        await page.locator('#soloQuery').fill('')
        await page.locator('#soloOrder').select_option('rating');await finished(page)
        assert any(c[0]=='tmdb' and c[2].get('sort_by')==['vote_average.desc'] for c in calls)
        await page.locator('[data-solo-view="list"]').click();assert 'list-view' in (await page.locator('#soloGrid').get_attribute('class'))
        await dimensions(page,'solo-list-desktop')
        # Requesting audio without its own key prompts setup rather than fabricating values.
        await page.locator('#soloAudio').select_option('cs')
        await page.locator('#audioDialog').wait_for(state='visible')
        await page.locator('#audioKey').fill('synthetic-audio-key')
        await page.locator('#audioConnectBtn').click()
        await page.wait_for_function("document.getElementById('audioConnectionStatus').textContent.startsWith('Připojeno')")
        await page.locator('[data-close-dialog="audioDialog"]').click();await finished(page)
        ids=await page.locator('#soloGrid [data-solo-audio]').evaluate_all('(els)=>els.map(x=>Number(x.dataset.soloAudio))')
        assert ids and all(i%6 in [0,1,4] for i in ids), ids
        # No cross-service false positives: HBO Czech does not mean Netflix Czech.
        await page.locator('#soloFiltersBtn').click()
        await page.locator('#maxCheck').uncheck(force=True)
        await page.locator('#startBtn').click();await finished(page)
        ids=await page.locator('#soloGrid [data-solo-audio]').evaluate_all('(els)=>els.map(x=>Number(x.dataset.soloAudio))')
        assert ids and all(i%6 in [0,4] for i in ids), ids
        await page.locator('#soloAudio').select_option('sk');await finished(page)
        ids=await page.locator('#soloGrid [data-solo-audio]').evaluate_all('(els)=>els.map(x=>Number(x.dataset.soloAudio))')
        assert ids and all(i%6==5 for i in ids), ids
        await page.locator('#soloAudio').select_option('cs-sk');await finished(page)
        ids=await page.locator('#soloGrid [data-solo-audio]').evaluate_all('(els)=>els.map(x=>Number(x.dataset.soloAudio))')
        assert ids and all(i%6 in [0,4,5] for i in ids), ids
        await page.locator('#soloGrid .solo-detail-btn').first.click()
        await page.locator('.audio-detail-row').first.wait_for()
        assert await page.locator('.audio-detail-row').count()==1
        await dimensions(page,'detail-desktop')
        await page.locator('[data-close-dialog="detailDialog"]').click()
        # Privacy: no secrets in query strings or wrong headers, session-only by default.
        for family,path,q,headers in calls:
            assert 'synthetic-' not in json.dumps(q)
            if family=='audio':assert headers.get('x-api-key')=='synthetic-audio-key'
            if family=='tmdb':assert headers.get('authorization')=='Bearer synthetic-tmdb-token'
        assert await page.evaluate("localStorage.getItem('filmRandeAudioKey')") is None
        assert await page.evaluate("!!sessionStorage.getItem('filmRandeAudioKey')")
        # Original couple mode still filters audio and keeps private votes.
        await page.locator('#soloFiltersBtn').click()
        await page.locator('input[name="playMode"][value="couple"]').check(force=True)
        await page.locator('#startBtn').click();await page.locator('#swipeScreen').wait_for(state='visible')
        await page.wait_for_function('!state.working')
        n=await page.evaluate('state.candidates.length');assert n>0
        assert await page.evaluate('state.candidates.every(m=>[0,4,5].includes(m.id%6))')
        for i in range(n):await page.locator(f'[data-score="{0 if i==0 else 2}"]').click()
        await page.locator('#handoffBtn').click()
        for _ in range(n):await page.locator('[data-score="2"]').click()
        await page.locator('#resultsScreen').wait_for(state='visible')
        assert await page.locator('#resultsGrid .result-card').count()==min(n-1,12)
        # Quick mode and TV retain audio filtering and correct identity.
        await page.locator('#resultFiltersBtn').click()
        await page.locator('input[name="playMode"][value="quick"]').check(force=True)
        await page.locator('#startBtn').click();await page.locator('#quickScreen').wait_for(state='visible')
        await page.wait_for_function('!state.working')
        first=await page.evaluate('state.quickItem.id')
        await page.locator('#nextQuickBtn').click();assert await page.evaluate('state.quickItem.id')!=first
        await page.locator('#quickFiltersBtn').click()
        await page.locator('input[name="mediaType"][value="tv"]').check(force=True)
        await page.wait_for_function("state.mediaType==='tv'&&!state.changingType")
        await page.locator('#startBtn').click();await page.locator('#quickScreen').wait_for(state='visible')
        await page.locator('#watchQuickBtn').click();await page.locator('.audio-detail-row').first.wait_for()
        assert 'epizody' in await page.locator('.audio-detail').inner_text()
        await page.locator('[data-close-dialog="detailDialog"]').click()
        await page.locator('#quickFiltersBtn').click()
        await page.locator('input[name="mediaType"][value="movie"]').check(force=True)
        await page.wait_for_function("state.mediaType==='movie'&&!state.changingType")
        # Responsive catalogue views.
        await page.locator('input[name="playMode"][value="solo"]').check(force=True)
        await page.locator('#audioFilter').select_option('any')
        await page.locator('#startBtn').click();await finished(page)
        await page.locator('[data-solo-view="grid"]').click()
        for width in [360,390,768]:
            await page.set_viewport_size({'width':width,'height':844});await dimensions(page,f'solo-{width}')
        # A stale response cannot navigate away from newly selected filters.
        settings['delay']=.3
        await page.locator('#soloMoreBtn').click()
        await page.locator('#soloFiltersBtn').click();await page.wait_for_timeout(600)
        assert await page.locator('#setupScreen').is_visible()
        settings['delay']=0
        # Disconnect clears both credentials and audio cache.
        page.on('dialog',lambda d:asyncio.create_task(d.accept()))
        await page.locator('#settingsBtn').click();await page.locator('#connectScreen').wait_for(state='visible')
        assert await page.evaluate("!sessionStorage.getItem('filmRandeTMDB')&&!sessionStorage.getItem('filmRandeAudioKey')&&!localStorage.getItem('filmRandeAudioKey')")
        assert not errors, errors
        await context.close()
        # Errors and empty states in isolated browsers with no previous cache.
        for name,opts in [('auth',{'tmdb401':True}),('quota',{'audio429':True}),('empty',{'empty':True})]:
            c=await browser.new_context(viewport={'width':390,'height':844});pg=await c.new_page();cc,ee=await fixture(pg,opts)
            if name=='auth':
                await load_page(pg);await pg.locator('#tokenInput').fill('synthetic-tmdb-token');await pg.locator('#connectBtn').click();await pg.locator('#connectError').wait_for(state='visible');assert '401' in await pg.locator('#connectError').inner_text()
            else:
                await connect(pg)
                if name=='quota':
                    await pg.locator('#audioSettingsBtn').click();await pg.locator('#audioKey').fill('synthetic-audio-key');await pg.locator('#audioConnectBtn').click();await pg.wait_for_function("document.getElementById('audioConnectionStatus').textContent.startsWith('Připojeno')");await pg.locator('[data-close-dialog="audioDialog"]').click();await pg.locator('#audioFilter').select_option('cs')
                await pg.locator('input[name="playMode"][value="solo"]').check(force=True);await pg.locator('#startBtn').click();await finished(pg)
                if name=='quota':assert 'počet dotazů' in await pg.locator('#soloError').inner_text()
                else:assert await pg.locator('#soloGrid .solo-tile').count()==0
            assert not ee,ee
            await c.close()
        await browser.close()
        print(json.dumps({'result':'PASS','checks':['solo pagination, dedup, search, sorting, views','CZ/SK/CZ-or-SK filters','service-bound audio, ignores subtitles and foreign region','couple voting regression','audio setup and key privacy','stale request cancellation','mobile 360/390/768 and desktop 1440','TMDb 401, audio 429, empty catalogue'],'screenshots':str(ROOT),'api_calls':len(calls)},ensure_ascii=False,indent=2))

if __name__=='__main__':asyncio.run(main())
