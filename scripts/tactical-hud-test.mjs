/** Actual UI clicks, grouped health cards, non-overlapping hotkeys and viewport layout. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/tactical-hud'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(); const errors = [], checks = [];
const check = (name, pass, detail) => { checks.push({name, pass: !!pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail ?? ''); };
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length, null, { timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('bootLoader')?.style.display === 'none', null, {timeout:45000});
    await page.locator('#btnEnterGame').click(); await page.locator('#btnStartMission').click();
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        Game.selection.clear(); Game.units.forEach(u => { u.alive = false; u.mesh.visible = false; }); Game.units = [];
        Game.playerTeam = 'french'; Game.groups = {};
        const kinds = ['fusilier','fusilier','fusilier','fusilier','fusilier','fm24','smg','officer','medic','hmg','mortar_60','r35','s35','panhard','transport_truck'];
        // Use the installed roster's infantry keys.
        kinds.splice(0, 5, ...Array(5).fill('fusilier'));
        window._hudUnits = kinds.map((kind, i) => Game.makeUnit('french', kind, 160 + i * 3, 200, { aiState: 'player' }));
        const rifles = _hudUnits.slice(0, 5); rifles[0].hp *= .25;
        Game.groups[1] = rifles.map(u => u.id); Game.groups[3] = rifles.slice(0, 2).map(u => u.id);
        _hudUnits.forEach(u => Game.selection.add(u.id)); Game.updateHUD();
        Game.cam.x = 190; Game.cam.z = 200; Game.cam.zoom = Game.cam.targetZoom = 55; Game.updateCamera(0); Game.syncUnitMeshes(0);
    });
    const initial = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.unit-card')], r = cards.find(c => c.dataset.selectKind === 'fusilier');
        return { cards: cards.length, count: r.querySelector('.card-count').textContent, hp: r.querySelector('.card-health strong').textContent,
            groups: r.querySelector('.card-groups').textContent, partial: r.querySelector('.partial')?.title, square: r.offsetWidth === r.offsetHeight };
    });
    check('same-type units collapse into one square with count and mean health', initial.cards === 11 && initial.count === '5' && initial.hp === '85%' && initial.square, initial);
    check('assigned and partial control groups are distinguished', initial.groups.includes('1') && initial.partial?.includes('2 of 5'));
    await page.locator('[data-select-kind="fusilier"]').click();
    check('card selects its five units', await page.evaluate(() => Game.selection.size === 5));
    await page.keyboard.press('Control+2'); await page.evaluate(() => Game.updateHUD());
    check('newly assigned group appears on the card', await page.locator('.card-groups').innerText().then(t => t.includes('2')));
    await page.keyboard.press('Shift+F');
    check('first aid modifier does not arm attack ground', await page.evaluate(() => Game._commandMode !== 'attackground'));
    await page.keyboard.press('f');
    check('F arms attack ground without using first aid', await page.evaluate(() => Game._commandMode === 'attackground' && _hudUnits[0]._firstAidKits === 0));
    await page.keyboard.press('Escape');
    await page.keyboard.press('q'); check('Q stays in grenade targeting', await page.evaluate(() => Game._commandMode === 'grenade'));
    await page.keyboard.press('n'); check('N stays in smoke targeting', await page.evaluate(() => Game._commandMode === 'smoke' && !_hudUnits[0]._entrenched));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { Game.selection.clear(); const m = _hudUnits.find(u => Game.isMortar(u)); Game.selection.add(m.id); Game.updateHUD(); });
    await page.locator('#cmdMortarRapid').click();
    check('Rapid button changes mortar preparation', await page.evaluate(() => Game.selectedPlayerUnits()[0].mortarFireMode === 'rapid'));
    await page.locator('#mortarAreaRadius').fill('14');
    await page.locator('#cmdAttackGround').click();
    const aim = await page.evaluate(() => {
        const p = new Game.THREE.Vector3(220, Game.getHeight(220, 200), 200).project(Game.camera);
        const r = Game.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
    });
    await page.mouse.click(aim.x, aim.y);
    check('left-click terrain places an area order and keeps selection', await page.evaluate(() => {
        const m = Game.selectedPlayerUnits()[0]; return Game.selection.size === 1 && m.bombardX != null && m.bombardRadius === 14 && Game._commandMode == null;
    }));
    await page.locator('#cmdAttackGround').click(); await page.locator('#cmdCancel').click();
    check('Cancel exits placement mode', await page.evaluate(() => Game._commandMode == null));
    await page.evaluate(() => { const u = Game.selectedPlayerUnits()[0]; Game.queueVehiclePath(u, 280, 220, () => { window._staleRouteApplied = true; }); });
    await page.locator('#cmdStop').click();
    check('Stop cancels pending routes and bombardment', await page.evaluate(() => { Game.processVehicleRouteQueue(); return !window._staleRouteApplied && Game.selectedPlayerUnits()[0].bombardX == null; }).catch(() => false));
    await page.locator('#cmdMortarMethod').click();
    check('Ranged button displays the selected preparation method', await page.evaluate(() => Game.selectedPlayerUnits()[0].mortarFireMode === 'ranged' && document.getElementById('cmdMortarMethod').getAttribute('aria-pressed') === 'true' && document.getElementById('cmdMortarRapid').getAttribute('aria-pressed') === 'false'));
    await page.waitForFunction(() => _hudUnits.every(u => u.mesh.userData.modelPath), null, {timeout:120000});
    await page.evaluate(() => { Game.syncUnitMeshes(0); Game.updateMinimap(); Game.renderScene(); });
    await page.screenshot({path: `${out}/mortar.png`});
    await page.evaluate(() => { Game.selection.clear(); _hudUnits.forEach(u => Game.selection.add(u.id)); Game.updateHUD(); });
    for (const width of [1920, 1440, 1280, 900, 600]) {
        await page.setViewportSize({width, height: 900});
        const layout = await page.evaluate(() => {
            const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
            const map = box('.minimap-section'); const hud = box('#hudBar'), roster = box('#selectedPanel'), orders = box('.cmd-section'), ground = box('#cmdAttackGround');
            return {hud,roster,orders,ground,map,body:document.documentElement.scrollWidth,viewport:innerWidth,
                clipped: [...document.querySelectorAll('.cmd-section button')].filter(b => b.offsetParent !== null && !b.closest('.tactics-section')).filter(b => {
                    const r=b.getBoundingClientRect(); return r.bottom > hud.bottom + 1 || r.right > innerWidth + 1;
                }).map(b=>b.id)};
        });
        check(`${width}px: attack ground and contextual controls fit`, !layout.clipped.length && layout.ground.right <= width && layout.body <= width && layout.roster.bottom <= layout.hud.bottom + 1, layout);
        if (width > 700) check(`${width}px: orders left and map right`, layout.orders.x < layout.roster.x && layout.roster.x < layout.map.x);
        if (width >= 1280) check(`${width}px: unit roster receives more width than orders`, layout.roster.w > layout.orders.w);
        await page.evaluate(() => { Game.updateCamera(0); Game.syncUnitMeshes(0); Game.renderScene(); });
        await page.screenshot({path:`${out}/roster-${width}.png`});
    }
    await page.setViewportSize({width:1280,height:900});
    await page.locator('.tactics-menu summary').click();
    check('formation and readiness remain accessible', await page.locator('[data-formation="wedge"]').isVisible());
    await page.locator('[data-formation="wedge"]').click();
    check('formation button works in compact panel', await page.evaluate(() => Game.currentFormation === 'wedge'));
    await page.screenshot({path:`${out}/formation.png`});
    check('no browser errors', errors.length === 0, errors);
} finally { await browser.close(); fs.writeFileSync(`${out}/checks.json`, JSON.stringify({checks, errors}, null, 2)); }
if (checks.some(c => !c.pass) || errors.length) process.exitCode = 1;
