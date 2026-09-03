The original brief this project was built from, as written by the user.

Morning Diner — Three.js First-Person Walk

I want you to build a first-person walking experience inside a small roadside diner at 8 AM on a hot summer morning. This is an interior build. Sun pouring through venetian blinds casting hard stripe shadows across red vinyl booths. Dust floating in the light beams. A coffee pot sitting on the counter with steam curling off it. Through the front glass you can see a parking lot already cooking in the heat — shimmer rising off the asphalt.

This should look like a real photograph. Not stylized, not low-poly. Think the opening shot of a Terrence Malick film or a Gregory Crewdson photograph. A paused frame should be indistinguishable from a real photo of an empty diner in the Southwest at 8 in the morning.

The player walks through the front door into the diner. Red vinyl booths along the window wall. A counter with round stools. Checkered floor. Ceiling fan turning slowly. A radio playing quietly somewhere. The AC unit humming. Outside: a mostly empty parking lot, one or two cars, flat horizon, brutal morning sun. The whole thing feels warm and still and quiet.

Do this in Three.js. Zero external assets. Every texture, every mesh, every sound must be generated procedurally in code. Nothing downloaded. Nothing imported. Everything from math.

Interactions

Exactly 3 interactions. No more. No less. No extra interactions sneak in during development.

Sit in the booth — walk to a booth by the window, press to sit. Camera lowers to seated height. You see the parking lot through the blinds, the stripe shadows fall across the table.

Pour coffee — a coffee pot on the counter. Press to pour into a ceramic mug. Liquid fills, steam rises. Sound of coffee hitting ceramic.

Open the front door to the lot — walk to the front door, press to push it open. A wall of heat sound hits. Sunlight floods in brighter. You see the parking lot and the heat shimmer. The door swings with weight.

we can make it like press E to do this that.... or other keys like you know

That's it. Nothing else is interactive. The radio plays on its own. The AC hums on its own. The ceiling fan turns on its own. Those are ambient — not systems, not toggleable.

How to build this

Work on ONE system at a time in this exact order. Do NOT fan out multiple sub-agents in parallel — my machine can't handle it. Build each system sequentially:
Interior geometry and floor plan — small rectangular diner. Counter with stools on one side, 4-5 booths along the window wall on the other. Checkered tile floor. Ceiling tiles. A front door with glass. A back wall with a pass-through window to the kitchen. Keep the geometry tight — this is a small diner, not a restaurant.

Booth and counter detail — red vinyl booth seats with that slightly cracked, slightly shiny texture. Formica tabletops. Napkin dispensers. Ceramic coffee mugs. A coffee pot on a warmer behind the counter. Round chrome stools with red tops. The details that make it feel real, not the details that make it feel busy. No menus, no food, no plates of eggs. Empty diner, just opened.

Windows, blinds, and exterior view — venetian blinds on every window, half-open, casting hard stripe shadows that fall across the booths and floor. Through the blinds and the front glass: a parking lot with cracked asphalt, faded parking lines, one or two simple car shapes, flat horizon, sky already washed out by the sun. The exterior doesn't need to be a full world — just enough to be convincing through glass.

Lighting — this is the hardest system and the most important. Morning sun coming from outside through the blinds at a low-ish angle. Hard directional light creating stripe shadows from the blinds across every surface. The light should feel warm and heavy — not golden hour warm, just hot morning white-yellow. Interior should have overhead fluorescents that are on but losing the fight against the sunlight. Dust particles visible in the sun beams. The contrast between the bright window side and the darker counter side is what makes the frame.

Materials and textures — procedural everything. Checkered floor tile with slight wear and scuff. Vinyl booth material — slightly reflective, slightly textured, that deep diner red. Formica countertop with that fake marble pattern. Chrome on the stools and napkin dispensers. The glass in the front door and windows. Ceramic mugs. The coffee pot glass with dark liquid inside. Every material should respond to the lighting from system 4.

Sound design — procedural ambient, not audio files. A radio playing quietly — just the tone and rhythm of AM talk radio, not real words. AC unit drone — low, constant, the sound of an old window unit working hard. Ceiling fan whoosh — slow, rhythmic. Coffee pot — occasional gurgle and hiss from the warmer. Silence underneath all of it. The quiet is the point. These are all ambient loops that play on their own. They are NOT interactive systems.

The 3 interactions — sit in booth (camera transition to seated, shadow stripes across the table), pour coffee (liquid sim, steam particles, ceramic sound), open front door (door swing animation, light flood, heat sound wall, heat shimmer visible through the open door). Build all three. Test all three. No more than three.

Post-processing and final polish — warm color grading but NOT orange. Think slightly overexposed whites, warm shadows, the look of an old film photograph. Subtle depth of field. No film grain this time — the diner should feel clean and sharp, not moody. No lens flare. No bloom. Just accurate, slightly warm, photorealistic light.

Critic protocol

For each system: build it, then spawn ONE separate sub-agent as a harsh visual critic. The critic should compare the rendered output against real photographs of diners in morning light. Not "does this look like a good game." Not "is this a nice scene." The question is: "If I paused this and showed it to someone, would they think it's a photograph of a real diner?"

The critic must never be the same agent that built the system. It should only see the rendered frame, not the code. If it doesn't pass, iterate until it does before moving to the next system.

/loop  on each system until the critic says it genuinely looks like a real photograph. Then move to the next system.

Do NOT
Do NOT add fog, rain, wet surfaces, neon, or night lighting. This is a dry, hot, bright morning.
Do NOT add golden hour lighting. The sun is already up and harsh, not low and romantic.
Do NOT add UI, HUD, health bars, inventory, or any game interface.
Do NOT add NPCs, people, characters, or silhouettes of people.
Do NOT add more than 3 interactions. No jukebox. No cash register. No light switches.
Do NOT add combat, weapons, or any game mechanics beyond the 3 interactions.
Do NOT add a skybox with clouds. The sky through the windows is washed out bright white-blue.
Do NOT add music. The radio ambient is enough.
Do NOT add extra rooms, a bathroom, or a kitchen interior. The kitchen is a dark shape through the pass-through window, nothing more.
Do NOT add particle effects beyond dust in sunbeams and coffee steam.
Do NOT fan out parallel sub-agents. Sequential only. One system at a time.
Do NOT download, import, or reference any external assets, textures, models, or audio files.
Do NOT exceed the 3 interaction cap for any reason.

Skills and references

Explore for skills for Three.js and install skills first from existing builds and go to official Three.js skills:

https://github.com/cloudai-x/threejs-skills
https://github.com/dgreenheck/webgpu-claude-skill
https://github.com/majidmanzarpour/threejs-game-skills

And other Three.js AAA game skills from https://www.skills.sh/ /find-skills  threejs AAA Game

Machine constraints

RTX 4060, Ryzen 5 7600X, 32GB RAM. 200Hz monitor. CPU and GPU shouldn't be maxing out. Don't fry my PC. Any tests run on the second screen. I game on the first.

Don't stop until a paused frame looks like a photograph you'd see in a coffee table book about diners.

read the global cursor rules about my machine too, now start

and for everychanges https://github.com/StarKnightt create an repo here and make the repo private for now and push the changes etc
