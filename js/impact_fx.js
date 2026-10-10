/** Contact effects, independent of damage resolution. A tracer carries an
 * immutable impact description and delivers it once, even if its glint is culled. */
Game.weaponImpactProfile = weapon => {
    const small = ['none','rifle','sniper','pistol','smg','lmg','hmg','mg','machine','at_rifle'].includes(weapon.type);
    const he = !small && (weapon.heBlast || 0) > 1;
    return { kind: small ? 'bullet' : he ? 'he' : 'kinetic',
        scale: he ? Game.clamp(Math.sqrt(weapon.heBlast / 2.2), .55, 1.8) : small ? .18 : .55 };
};

Game.craterHeightOffset = (x,z) => {
    const g=Game._terrainDeformation;if(!g || g.geo!==Game.terrainMesh?.geometry)return 0;
    const u=Game.clamp((x-Game.WORLD_W/2-g.x0)/(g.x1-g.x0)*g.segX,0,g.segX);
    const v=Game.clamp((z-Game.WORLD_H/2-g.z0)/(g.z1-g.z0)*g.segZ,0,g.segZ);
    const a=Math.floor(u),b=Math.floor(v),fx=u-a,fz=v-b,stride=g.segX+1;
    const a1=Math.min(a+1,g.segX),b1=Math.min(b+1,g.segZ),d=g.delta;
    return (d[b*stride+a]*(1-fx)+d[b*stride+a1]*fx)*(1-fz)
        +(d[b1*stride+a]*(1-fx)+d[b1*stride+a1]*fx)*fz;
};

Game.conformScorch = s => {
    const p=s.mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++)p.setY(i,(Game.getHeight?.(s.x+p.getX(i),s.z+p.getZ(i))||0)+.018);
    p.needsUpdate=true;s.mesh.geometry.computeBoundingSphere();
    s.groundRevision=Game._craterPerf.batches;
};

Game.emitWeaponImpact = (x, z, profile, angle = 0, onArmor = false) => {
    const random = Game._tracerRandom, range = (a,b) => a + (b-a)*random();
    const tile = Game.getTileAtWorld?.(x,z), water = tile?.type === 'water';
    const hard = onArmor || ['road','yard','wall','house'].includes(tile?.type);
    const he = profile.kind === 'he', small = profile.kind === 'bullet';
    if (small && !onArmor && random() > .28) return;
    const scale = profile.scale, y = (Game.getHeight?.(x,z) || 0) + .05;
    if (!small || onArmor) (Game.muzzleFlashes ||= []).push({ x, z,
        y: y + (onArmor ? .65 : .08), r: (he ? .7 : .22)*scale,
        life: he ? .075 : .045, total: he ? .075 : .045, big: he, mesh: null });
    // Four to seven short puffs expose the contact point, then clear enough to
    // see the men falling. The surface supplies the colour; rain reduces dust.
    const mod = Game._dustModAt?.(x,z) || {amount:1,life:1,radius:1,rise:1};
    const n = Math.max(1, Math.round((he ? 5 : small ? 1 : 3) * mod.amount));
    if (Game.smoke.length < 240) for (let i=0;i<n;i++) {
        const a = he || water ? range(0,Math.PI*2) : angle + range(-.45,.45);
        const speed = range(.5,2.2)*scale, life = range(.5,1.1)*mod.life;
        Game.smoke.push({ x:x+Math.cos(a)*.12*scale, z:z+Math.sin(a)*.12*scale,
            baseY:y, r:range(.3,.7)*scale*mod.radius, life,total:life,
            vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,
            rise:(i===0&&he?1.9:.5)*scale*mod.rise, maxOpacity:he?.68:.43,
            dust:true,tint:water?0xc5d0cf:undefined,mesh:null });
    }
    if (!small && !onArmor && !water) {
        if (he && scale >= 1.05) Game.addScorch?.(x,z,.55*scale);
        // A small round cannot displace an entire coarse terrain vertex. Its
        // contact scar remains visible; only resolvable blasts move the grid.
        if (he && !hard) Game.spawnCrater?.(x,z,1.25*scale,.16*scale);
    }
    if (!small && !water) {
        const list = Game._impactDebris ||= [];
        for (let i=0;i<(he?9:4)&&list.length<128;i++) {
            const a=he?range(0,Math.PI*2):angle+range(-.65,.65),speed=range(1.2,4)*scale;
            list.push({x,z,y:y+(onArmor?.65:0),vx:Math.cos(a)*speed,vz:Math.sin(a)*speed,
                vy:range(1.4,3.6)*scale,life:range(.35,.8),size:range(.035,.085)*scale,
                tone:hard?0x99958a:0x65533c,spin:range(0,6)});
        }
    }
};

Game.updateImpactDebris = dt => {
    const T=Game.THREE,list=Game._impactDebris;
    if (!list?.length) { if(Game._impactDebrisBatch)Game._impactDebrisBatch.mesh.count=0;return; }
    let b=Game._impactDebrisBatch;
    if (!b) {
        const mesh=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),
            new T.MeshLambertMaterial({color:0xffffff}),128);
        mesh.name='impact-earth-fragments';mesh.frustumCulled=false;mesh.raycast=()=>{};
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        b=Game._impactDebrisBatch={mesh,dummy:new T.Object3D(),color:new T.Color()};
    }
    if(b.mesh.parent!==Game.effectsGroup)Game.effectsGroup.add(b.mesh);
    let count=0;
    for(let i=list.length-1;i>=0;i--){const p=list[i];p.life-=dt;p.vy-=8.5*dt;
        p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;
        if(p.life<=0||p.y<(Game.getHeight?.(p.x,p.z)||0)){list.splice(i,1);continue;}
        b.dummy.position.set(p.x,p.y,p.z);b.dummy.rotation.set(p.spin+p.life*8,p.spin,0);
        b.dummy.scale.setScalar(p.size*Math.min(1,p.life*6));b.dummy.updateMatrix();
        b.mesh.setMatrixAt(count,b.dummy.matrix);b.mesh.setColorAt(count++,b.color.setHex(p.tone));
    }
    b.mesh.count=count;b.mesh.instanceMatrix.needsUpdate=true;
    if(b.mesh.instanceColor)b.mesh.instanceColor.needsUpdate=true;
};
