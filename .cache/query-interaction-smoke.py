import sys
sys.path.insert(0,'.cache/browser-test')
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True,args=['--disable-gpu'])
 page=browser.new_page(viewport={'width':1500,'height':900});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto('http://127.0.0.1:8000/#general',wait_until='domcontentloaded',timeout=30000)
 page.wait_for_function("document.querySelector('#source-status')?.textContent === 'Datos cargados'",timeout=30000)
 print('indexes',page.evaluate("() => ({trades:!!queryTradeIndex,similarity:!!querySimilarityIndex,news:issuerNewsAvailable, lazy:[...issuerNewsIndex.values()].some(x => !x.detailsLoaded)})"))
 page.locator('#pnl-unit-toggle').click();print('toggle_usd',page.locator('[data-pnl-unit-label]').first.inner_text())
 page.evaluate("() => location.hash = 'data'");page.wait_for_timeout(400)
 page.locator('#issuer-search').fill('BENF'); row=page.locator('#issuer-table tr').filter(has_text='BENF').first
 print('benf_row',row.count(),'news',row.locator('.issuer-news').inner_text()[:100])
 details=row.locator('details.issuer-news-details');details.locator('summary').click();page.wait_for_timeout(900)
 print('news_detail',row.locator('.news-detail-content').inner_text()[:140])
 page.evaluate("() => location.hash = 'watchlist'");page.wait_for_timeout(200)
 page.locator('#watchlist-add').click();page.locator('#watchlist-symbol').fill('BENF');page.locator('#watchlist-add-form button[type=submit]').click()
 page.wait_for_timeout(1500)
 print('watchlist_info',page.locator('.watchlist-trade-details').first.inner_text()[:180])
 sessions=page.locator('.watchlist-last-session');print('sessions',sessions.count())
 print('session_debug',sessions.first.locator('summary').evaluate("el => ({rect:el.getBoundingClientRect().toJSON(),hidden:el.closest('tr')?.hidden, display:getComputedStyle(el).display,vis:getComputedStyle(el).visibility, parent:el.closest('details').outerHTML.slice(0,250)})")); sessions.first.locator('summary').click(timeout=4000);page.wait_for_timeout(1400)
 print('price_svg',sessions.first.locator('.trade-candle-svg').count(),'section_open',sessions.first.get_attribute('open'))
 print('errors',errors[:10]);browser.close()

