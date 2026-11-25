"""Recorre la app y apunta todos los textos que salen en pantalla (para traducirlos) o, con LANG=en, los que faltan."""
import asyncio, json, os, subprocess, sys
from playwright.async_api import async_playwright
MODE = sys.argv[1] if len(sys.argv) > 1 else 'collect'
B = 'http://localhost:8888/'
def sql(q): subprocess.run(['psql','-h','127.0.0.1','-U','postgres','-d','ranking','-qc',q], env={'PGPASSWORD':'pg','PATH':'/usr/bin:/bin'})
async def main():
    seen = set(); errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, locale='es-ES')
        await ctx.expose_function('colpy', lambda s: seen.add(s))
        if MODE == 'collect': await ctx.add_init_script("window.__col = (s) => window.colpy(s);")
        else: await ctx.add_init_script("try{localStorage.setItem('atc_lang','en')}catch(e){}; window.__seen = (s)=>window.colpy(s);")
        pg = await ctx.new_page(); pg.set_default_timeout(2500)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def w(ms=450): await pg.wait_for_timeout(ms)
        async def go(h, ms=700): await pg.goto(B + '#/' + h); await w(ms)
        async def t(fn):
            try: await fn()
            except Exception as e: errs.append('STEP ' + str(e).split('\n')[0][:90])
        async def miss():
            if MODE != 'collect':
                for s in await pg.evaluate("[...window.__miss]"): seen.add(s)
        async def click(sel, ms=450): await pg.click(sel); await w(ms)
        async def login(u):
            await miss(); await pg.evaluate("(()=>{const l=localStorage.getItem('atc_lang');localStorage.clear();if(l)localStorage.setItem('atc_lang',l)})()")
            await pg.goto(B + '#/login'); await pg.reload(); await w(400)
            await pg.fill('[name=username]', u); await pg.fill('[name=pin]', '482915'); await pg.click('form button'); await w(1100)
        # ── sin sesión ──
        await pg.goto(B); await w(600)
        await t(lambda: click('form button'))
        async def bad():
            await pg.fill('[name=username]', 'nadie'); await pg.fill('[name=pin]', '111111'); await click('form button', 700)
        await t(bad)
        await go('olvide'); await t(lambda: click('form button', 600))
        async def fg():
            await pg.fill('form input', 'marta'); await click('form button', 900)
        await t(fg)
        await go('reset?t=abc')
        async def rs():
            ins = pg.locator('form input'); await ins.nth(0).fill('123456'); await ins.nth(1).fill('654321'); await click('form button', 600)
            await ins.nth(1).fill('123456'); await click('form button', 800)
        await t(rs)
        await go('privacidad'); await go('diag', 900)
        await go('registro'); await t(lambda: click('form button'))
        async def reg():
            await pg.fill('[name=full_name]', 'Al'); await click('form button')
            await pg.fill('[name=full_name]', 'Nora Prueba'); await click('form button')
            await pg.fill('[name=username]', 'x'); await click('form button')
            await pg.fill('[name=username]', 'nora' + os.urandom(2).hex()); await click('form button')
            await pg.fill('[name=email]', 'mal'); await click('form button')
            await pg.fill('[name=email]', 'nora' + os.urandom(2).hex() + '@test.com'); await click('form button')
            await pg.fill('[name=pin]', '12'); await click('form button')
            await pg.fill('[name=pin]', '591720'); await click('form button')
            await pg.fill('[name=birth_date]', '2015-06-15'); await click('form button')
            await pg.fill('[name=birth_date]', '1995-06-15'); await click('form button')
            await pg.check('[name=accept]'); await click('form button', 600)
            await click('.seg[data-k=hand] button[data-v=zurdo]'); await click('#save', 1300)
        await t(reg)
        # ── jugador nuevo, antes de empezar la temporada ──
        sql("update season set starts_on=current_date+5, ends_on=current_date+64, masters_end=current_date+78")
        await go(''); await go('perfil', 900); await t(lambda: click('a[href="#/carta"]', 600)); await t(lambda: click('#save', 1000))
        await go('retos'); await go('tablon'); await go('masters')
        await t(lambda: pg.locator('.prow:not(.me)').first.click()); await w(900)
        sql("update season set starts_on=current_date+1")
        await go(''); await t(lambda: pg.locator('.prow:not(.me)').first.click()); await w(900)
        await go('ajustes', 900)
        await t(lambda: click('.seg[data-k=hand] button[data-v=diestro]', 700))
        await t(lambda: pg.locator('[data-n]').first.click()); await w(600)
        async def pin():
            await pg.fill('#pinf [name=old]', '000000'); await pg.fill('#pinf [name=pin]', '12'); await click('#pinf button', 800)
            await pg.fill('#pinf [name=old]', '591720'); await click('#pinf button', 800)
            await pg.fill('#pinf [name=pin]', '591720'); await click('#pinf button', 900)
        await t(pin)
        async def dele():
            await click('#del', 500); await pg.fill('#dp', '000000'); await click('#go', 900)
        await t(dele)
        # ── Jesús, temporada en marcha ──
        sql("update season set starts_on=current_date-22, ends_on=current_date+27, masters_end=current_date+38")
        await login('jesus')
        await t(lambda: click('.tabs button[data-t=nivel]')); await t(lambda: click('.tabs button[data-t=puntos]'))
        async def srch():
            await pg.fill('#q', 'zzzz'); await w(300); await pg.fill('#q', ''); await w(300)
        await t(srch)
        await t(lambda: click('.prow:has-text("Sergio")', 1000))
        await t(lambda: click('main a.btn.block', 800))
        await t(lambda: click('#send', 700))
        async def ch():
            await pg.locator('[data-k=date] .chip').nth(2).click(); await pg.locator('[data-k=time] .chip').nth(1).click(); await w(300)
            await pg.fill('textarea', 'Vamos'); await click('#send', 1200)
        await t(ch)
        await go('retos', 1000)
        await t(lambda: click('a:has-text("Otra hora"), a[href^="#/reto/"]', 700)); await t(lambda: click('#send', 700))
        async def ct():
            await pg.locator('[data-k=date] .chip').nth(3).click(); await pg.locator('[data-k=time] .chip').nth(4).click(); await click('#send', 1100)
        await t(ct)
        await go('retos', 900)
        await t(lambda: click('button[data-dispute]', 500)); await t(lambda: click('.sheet [data-close=no]', 400))
        await t(lambda: click('button[data-confirm]', 1200))
        await t(lambda: click('button[data-cancel]', 500)); await t(lambda: click('.sheet [data-close=no]', 400))
        sql("update challenges set play_at = now() - interval '1 day' where status='accepted'")
        await go('retos', 900)
        await t(lambda: click('a[href^="#/resultado/"]', 700)); await t(lambda: click('#send', 600))
        async def res():
            for i, v in enumerate(['6','4','3','6']): await pg.locator('.setrow .input').nth(i).fill(v)
            await click('#send', 600)
            for i, v in enumerate(['10','8']): await pg.locator('.setrow .input').nth(4 + i).fill(v)
            await click('#send', 1200)
        await t(res)
        await go('retos', 900); await t(lambda: click('button[data-withdraw]', 900))
        await go('tablon', 1000)
        await t(lambda: pg.locator('button[data-like]').first.click()); await w(700)
        await t(lambda: pg.locator('button[data-likers]').first.click()); await w(600); await t(lambda: click('.sheet [data-close]', 400))
        await t(lambda: pg.locator('button[data-open]').first.click()); await w(400)
        async def cm():
            await pg.locator('.cform input').first.fill('Buen partido'); await pg.locator('.cform button').first.click(); await w(1100)
            await pg.locator('button[data-delc]').first.click(); await w(400); await click('.sheet [data-close=no]', 300)
            await pg.locator('button[data-close]').first.click(); await w(300)
        await t(cm)
        await go('perfil', 900); await go('masters', 800)
        # Marta: le toca responder; rechazos
        await login('marta'); await go('retos', 900)
        await t(lambda: click('button[data-act=reject]', 700)); await t(lambda: click('.sheet [data-close=ok]', 1100))
        await login('carlos'); await go('retos', 900)
        await t(lambda: click('button[data-dispute]', 500))
        async def dsp():
            await pg.fill('#note', 'No fue así'); await click('#send', 1000)
        await t(dsp)
        await t(lambda: click('button[data-act=accept]', 1100))
        # grupos (día 30+) y fase regular terminada
        sql("update season set starts_on=current_date-40, ends_on=current_date+19")
        await login('ines'); await t(lambda: pg.locator('.prow').first.click()); await w(1000)
        sql("update season set starts_on=current_date-62, ends_on=current_date-2, masters_end=current_date+12")
        await go(''); await t(lambda: pg.locator('.prow:not(.me)').first.click()); await w(900); await go('retos', 800)
        # ── admin ──
        sql("update season set starts_on=current_date-22, ends_on=current_date+27, masters_end=current_date+38")
        await login('gero'); await go('perfil', 900); await go('admin', 1200)
        await t(lambda: click('#copymails', 600)); await t(lambda: click('.sheet [data-close]', 300))
        for tab in ['partidos', 'jugadores', 'temporada', 'avisos']:
            await t(lambda: click(f'[data-tab={tab}]', 500))
            await t(lambda: pg.locator('details.adm summary').first.click()); await w(300)
            if tab == 'partidos':
                await t(lambda: pg.locator('[data-mact=annul]').first.click()); await w(400); await t(lambda: click('.sheet [data-close=no]', 300))
                await t(lambda: pg.locator('[data-mact=set]').first.click()); await w(900)
            if tab == 'jugadores':
                await t(lambda: pg.locator('[data-psave]').first.click()); await w(900)
                await t(lambda: click('[data-tab=jugadores]', 400)); await t(lambda: pg.locator('details.adm summary').first.click())
                await t(lambda: pg.locator('[data-pdel]').first.click()); await w(400); await t(lambda: click('.sheet [data-close=no]', 300))
            if tab == 'avisos':
                await t(lambda: click('#pf button', 700))
            if tab == 'temporada':
                await t(lambda: click('#sf button', 900)); await t(lambda: click('[data-tab=temporada]', 400))
        await t(lambda: click('[data-tab=temporada]', 400))
        await t(lambda: click('#gen', 400)); await t(lambda: click('.sheet [data-close=ok]', 1800))
        await go('masters', 1000); await t(lambda: pg.locator('.chip').nth(1).click()); await w(300)
        await go('', 900); await go('retos', 900); await go('tablon', 900)
        await login('sergio'); await go('retos', 900); await t(lambda: click('a[href^="#/master/"]', 700)); await t(lambda: click('#send', 600))
        await login('gero'); await go('admin', 1000); await t(lambda: click('[data-tab=temporada]', 400))
        await t(lambda: click('#close', 400)); await t(lambda: click('.sheet [data-close=ok]', 1200))
        await go('', 900); await go('masters', 900)
        await t(lambda: go('admin', 900)); await t(lambda: click('[data-tab=temporada]', 400)); await t(lambda: click('#mreset', 400)); await t(lambda: click('.sheet [data-close=no]', 300))
        await go('nada-de-nada', 500)
        await miss()
        await b.close()
    json.dump(sorted(seen), open('/tmp/crawl_%s.json' % MODE, 'w'), ensure_ascii=False, indent=0)
    print(MODE, len(seen), 'textos;', len(errs), 'avisos'); [print('  ', e) for e in errs[:40]]
asyncio.run(main())
