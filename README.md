# Godbox Earth

A 3D god-game on a procedural globe (three.js). You are the people's one true god. They have their own minds, and belief is theirs to give.

**Play:** https://dominicvii.github.io/godbox/

## Controls
- Drag to orbit, use the wheel to zoom from orbit down to the ground, double-click to fly somewhere. Right-drag or Q/E turns the view. F follows the selected person.
- Pick a power from the palette (Create / Bless / Destroy / Terrain / People / Time / World) or press its key, then click the globe. The ring shows the power's reach. A click that misses tells you why.
- Space pauses, - and = change speed, [ and ] change the brush size, / opens the Codex, ? opens help, Esc closes things.
- To move a panel, drag its title bar. ▾ folds it and double-clicking the title resets its place.

## How they live
- **A day, a home, a trade.** Everyone has a house (their parents' or their spouse's; newlyweds take an empty one) and a place of work by trade: fields, forest, hills, the market square, the shrine, the wall. The visible day follows the sun where they live. At dawn they wake, by day they work (with a bite at noon), and in the evening they have supper at home and then gather at the fire in the square or visit a friend. At night they sleep indoors. What their mind chose for the day (a day of rest, a visit to the shrine, a sermon, courting someone) shapes that day.
- **Families and bonds.** Founding peoples start as households: a couple, their children and their kin, under one roof. Children are bound to their parents and siblings, and families grieve their dead. Friendships grow from evenings together and from working side by side, they favour people of a like temper, and they fade without contact. Hot tempers and bad fits quarrel into grudges. Couples in love marry first, and families arrange matches for the rest. A shared life keeps a marriage warm, kinder hearts more so. A person the god shapes from the dust founds a house of their own.
- **Traits are real.** Innate and god-given traits change the body the sim uses: a Fast walker walks faster, Tough and Unaging people take blows and plague better, Long-lived people live longer, and Infertile people have no children. People speak of their gifts in their own words, and carrying too many weighs on them.
- **The world.** Near the ground there is a sky (blue by day, red at either end of it, stars at night), a sun that warms and dims as it sets, a moon, shadows, clouds with drifting storm cells that bring rain (snow in the cold), and grass and wild flowers underfoot. Rain from the god gathers a storm.
- **Any speed.** A person decides about once a day. When the game runs fast the page steps coarser, or updates only part of the crowd each frame, within a frame budget. A decision then stands for the days it covers, so a life keeps the same shape at any speed.

## Weather: `GB.weather`
`GB.weather.storm(x, y, life?)` gathers a storm cell over tile x, y (`life` in sun-clock units, default 900). `GB.weather.clear()` clears the skies. `GB.weather.at(x, y)` reads the storm strength there (0..1).

## Plug-in powers: `GB.registerPower(def)`
```js
GB.registerPower({
  id: 'locusts', name: 'Locusts', icon: '🦗', group: 'Destroy', // Create|Bless|Destroy|Terrain|People|Time, or a new group
  radius: 6,            // tiles; number or (params)=>number. Drawn as the cursor ring
  key: 'n',             // optional hotkey. If it clashes, a free key is chosen and the tooltip says so
  paint: false,         // true = keeps applying while you drag
  params: { radius: 6 },// editable in the options strip; params.options = { name: [choices] } makes a dropdown
  hint: 'Eat the harvest',
  apply(ctx) {          // ctx: x, y (tiles), radius, params, people, kingdom, nation, civ, world, mind,
                        //      notify(ev), log(s), chronicle(s), toast(s, ok), ask(title, ph) -> Promise,
                        //      fx.rain(), fx.lightning(), fx.ring(color, radius, secs)
    if (!ctx.people.length) return { miss: 'No one here.' };   // shows feedback instead of a silent miss
    ctx.people.forEach(p => p.hunger += 40);
    return { message: `Locusts strip the fields of ${ctx.people.length}.` };
  }
});   // returns an unregister function
```
`godbox-powers.js` (rain, drought, bless/curse a nation, vision, raise/sink land, plague, heal, lightning, feast) is wired through this API. Its hotkeys follow the module's own, except Feast, which moves from F (Follow) to Z.
