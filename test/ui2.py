import asyncio
from playwright.async_api import async_playwright
OUT='/tmp/shots/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, locale='es-ES')
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        async def shot(n, full=False): await pg.wait_for_timeout(700); await pg.screenshot(path=OUT+n+'.png', full_page=full)
        async def login(u):
            await pg.evaluate("localStorage.clear()"); await pg.goto('http://localhost:8888/#/login'); await pg.reload()
            await pg.fill('[name=username]',u); await pg.fill('[name=pin]','482915'); await pg.click('button:has-text("Entrar")'); await pg.wait_for_timeout(800)
        await pg.goto('http://localhost:8888/'); await login('jesus')
        await pg.goto('http://localhost:8888/#/retos'); await pg.wait_for_timeout(700)
        await pg.click('button[data-confirm]'); await pg.wait_for_timeout(1200); await shot('20_retos_confirmado', True)
        # contrapropuesta
        await pg.click('a:has-text("Otra hora")'); await pg.wait_for_timeout(600)
        await pg.locator('[data-k=date] .chip').nth(3).click(); await pg.locator('[data-k=time] .chip').nth(4).click()
        await shot('21_otra_hora', True)
        await pg.click('#send'); await pg.wait_for_timeout(900); await shot('22_retos_tras_propuesta', True)
        # resultado de un partido aceptado (Jesús vs Carlos): mover a ayer
        import subprocess
        subprocess.run(['psql','-h','127.0.0.1','-U','postgres','-d','ranking','-qc',"update challenges set play_at = now() - interval '1 day' where status='accepted'"], env={'PGPASSWORD':'pg','PATH':'/usr/bin:/bin'})
        await pg.reload(); await pg.wait_for_timeout(900)
        await pg.click('a:has-text("Poner resultado")'); await pg.wait_for_timeout(600)
        for i,v in enumerate(['6','4','3','6','10','8']):
            await pg.locator('.setrow .input').nth(i).fill(v)
        await shot('23_resultado')
        await pg.click('#send'); await pg.wait_for_timeout(900)
        # Carlos confirma por email-link flow: GET act page
        await login('carlos'); await pg.goto('http://localhost:8888/#/retos'); await pg.wait_for_timeout(700); await shot('24_retos_carlos', True)
        await pg.click('button[data-dispute]'); await pg.wait_for_timeout(400); await pg.fill('#note','El tercero fue 10-6'); await shot('25_disputa')
        await pg.click('#send'); await pg.wait_for_timeout(900)
        await login('gero'); await pg.goto('http://localhost:8888/#/admin'); await pg.wait_for_timeout(900); await shot('26_admin_disputa')
        await pg.goto('http://localhost:8888/#/perfil'); await shot('27_perfil_gero', True)
        print('ERRORES', errs); await b.close()
asyncio.run(main())
