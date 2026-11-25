import asyncio, sys
from playwright.async_api import async_playwright
OUT='/tmp/shots/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
        pg = await ctx.new_page()
        errs=[]
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def shot(name, full=False):
            await pg.wait_for_timeout(700); await pg.screenshot(path=OUT+name+'.png', full_page=full)
        await pg.goto('http://localhost:8888/'); await shot('01_login')
        # Registro
        await pg.click('text=Crear cuenta'); await pg.wait_for_timeout(300)
        await pg.fill('[name=full_name]','Nuevo Jugador'); await pg.fill('[name=username]','nuevo'); await pg.fill('[name=email]','nuevo@test.com')
        await pg.fill('[name=pin]','591720'); await pg.fill('[name=birth_date]','1995-06-15'); await pg.check('[name=accept]')
        await shot('02_registro')
        await pg.click('text=Siguiente: mi carta'); await pg.wait_for_timeout(400)
        await pg.click('.seg[data-k=hand] button[data-v=zurdo]')
        await pg.locator('.slider').nth(0).fill('74'); await pg.locator('.slider').nth(2).fill('66')
        await shot('03_carta')
        await pg.click('#save'); await pg.wait_for_timeout(900)
        await shot('04_ranking_nuevo')
        await pg.goto('http://localhost:8888/#/perfil'); await shot('05_perfil_nuevo', True)
        # Jesús
        await pg.evaluate("localStorage.clear()"); await pg.goto('http://localhost:8888/#/login'); await pg.reload()
        await pg.fill('[name=username]','jesus'); await pg.fill('[name=pin]','482915'); await pg.click('button:has-text("Entrar")')
        await pg.wait_for_timeout(900); await shot('06_ranking', True)
        await pg.click('.tabs button[data-t=nivel]'); await shot('07_ranking_nivel')
        await pg.click('.tabs button[data-t=puntos]')
        await pg.click('.prow:has-text("Sergio")'); await shot('08_perfil_sergio', True)
        await pg.click('text=Retar a Sergio'); await pg.wait_for_timeout(500)
        await pg.locator('[data-k=date] .chip').nth(2).click(); await pg.locator('[data-k=time] .chip').nth(1).click()
        await shot('09_retar', True)
        await pg.goto('http://localhost:8888/#/retos'); await shot('10_retos', True)
        await pg.goto('http://localhost:8888/#/tablon'); await shot('11_tablon', True)
        await pg.click('[data-open]'); await shot('12_tablon_comentar')
        # resultado
        await pg.goto('http://localhost:8888/#/retos'); await pg.wait_for_timeout(600)
        await pg.click('text=Confirmar'); await pg.wait_for_timeout(900); await shot('13_retos_tras_confirmar', True)
        await pg.goto('http://localhost:8888/#/ajustes'); await shot('14_ajustes', True)
        # admin
        await pg.evaluate("localStorage.clear()"); await pg.goto('http://localhost:8888/#/login'); await pg.reload()
        await pg.fill('[name=username]','gero'); await pg.fill('[name=pin]','482915'); await pg.click('button:has-text("Entrar")')
        await pg.wait_for_timeout(800)
        await pg.goto('http://localhost:8888/#/admin'); await shot('15_admin', True)
        await pg.click('[data-tab=temporada]'); await shot('16_admin_temporada', True)
        await pg.click('#gen'); await pg.wait_for_timeout(300); await pg.click('.sheet [data-close=ok]'); await pg.wait_for_timeout(1500)
        await shot('17_masters', True)
        await pg.goto('http://localhost:8888/#/'); await shot('18_ranking_masters')
        print('ERRORES:', errs)
        await b.close()
asyncio.run(main())
