import sys
sys.path.insert(0,'.cache/browser-test')
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True,args=['--disable-gpu'])
 page=browser.new_page(); errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto('http://127.0.0.1:8000/#general',wait_until='domcontentloaded',timeout=30000)
 page.wait_for_function("document.querySelector('#source-status')?.textContent === 'Datos cargados'",timeout=30000)
 print('loaded',page.locator('#source-status').inner_text(),'overview',page.locator('#overview-stats').inner_text()[:90])
 for view in ['risk','calendar','data','price','duration','ratios','country','growth','projection','optimal','compare','trades','journal','watchlist']:
  page.evaluate('(view) => { location.hash = view; }',view); page.wait_for_timeout(350)
  print(view,'visible',page.locator('#view-'+view).is_visible())
 print('pageerrors',errors[:12]);browser.close()
