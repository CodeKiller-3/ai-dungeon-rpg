# -*- coding: utf-8 -*-
"""D-94 P7.5：真实 index.html 的战斗 HUD 实拍（HUD 重叠修复的改前/改后对照）
用法：python hud_shot.py before|after
出图：hud-{tag}-{W}x{H}.png（整屏）+ hud-{tag}-{W}x{H}-top.png（左上角 0..420×0..56，4× 放大）
不注入任何伪造 HUD 数据：走 index.html 的真实 init / Battle.start / switchScene。
"""
import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
URL = ('file:///d:/%E6%A1%8C%E9%9D%A2/%E5%B7%A5%E4%BD%9C/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD%E5%A4%A7%E4%BD%9C%E4%B8%9A/index.html')
VIEWS = [(1024, 640), (320, 568)]

BOOT_INIT = """
(function(){
  try { Game.Core.Main.init({ menu: false }); Game.Core.Main.start(); return 'ok'; }
  catch (e) { return 'ERR ' + (e && (e.stack || e.message)); }
})()
"""

BOOT = """
(function(){
  try {
    Game.Systems.Map.setFloor(1);
    var P = Game.Data.Player;
    P.floor = 1; P.level = 5; P.exp = 24; P.gold = 268;
    P.hp = 100; P.maxHp = 140; P.mp = 30; P.maxMp = 30;
    Game.Systems.Battle.start('slime');
    Game.Core.Main.switchScene('battle');
    Game.Core.Render.resize();
    Game.Core.Main._guideVisible = false;   /* 首次引导覆盖层会压暗整屏，实拍不需要 */
    Game.Core.Main._guidePending = false;
    if (Game.hud && Game.hud.update) {
      Game.hud.update({ hp: P.hp, hpMax: P.maxHp, mp: P.mp, mpMax: P.maxMp, gold: P.gold,
        floor: P.floor, level: P.level, exp: P.exp, expNext: 60 * P.level, status: [] });
    }
    return 'ok';
  } catch (e) { return 'ERR ' + (e && (e.stack || e.message)); }
})()
"""


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else 'before'
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True,
                              args=['--allow-file-access-from-files', '--disable-gpu',
                                    '--autoplay-policy=no-user-gesture-required'])
        for w, h in VIEWS:
            ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pg = ctx.new_page()
            pg.add_init_script('window.__AI_DUNGEON_NO_AUTOSTART__ = true;')
            pg.goto(URL)
            print(tag, w, h, pg.evaluate(BOOT_INIT), flush=True)
            pg.wait_for_function('window.Game && Game.Core && Game.Core.Sprites && Game.Core.Sprites.isReady()',
                                 timeout=30000)
            r = pg.evaluate(BOOT)
            print(tag, w, h, r, flush=True)
            pg.wait_for_timeout(3200)
            full = os.path.join(ROOT, 'hud-%s-%dx%d.png' % (tag, w, h))
            pg.screenshot(path=full)
            # 左上角放大：宽屏取 0..420、窄屏整宽
            cw = min(w, 420)
            pg.screenshot(path=os.path.join(ROOT, 'hud-%s-%dx%d-top.png' % (tag, w, h)),
                          clip={'x': 0, 'y': 0, 'width': cw, 'height': 56})
            print('   ->', os.path.basename(full), flush=True)
            ctx.close()
        b.close()


if __name__ == '__main__':
    main()
