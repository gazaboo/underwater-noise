"""Modèles originaux du pilote : blender -b --python tools/diorama/build_assets.py.
Toutes les formes, proportions et couleurs sont artistiques. Aucun asset externe.
"""
import bpy, math, random
from mathutils import Vector
from pathlib import Path
bpy.context.preferences.filepaths.save_version=0
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'client/public/models/diorama'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mat=bpy.data.materials.new('Natural miniature - vertex pigment');mat.diffuse_color=(.5,.6,.3,1);mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.88
vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Pigment';mat.node_tree.links.new(vc.outputs['Color'],bsdf.inputs['Base Color'])

def pigment(obj,base,seed=0,kind='leaf'):
    mesh=obj.data; layer=mesh.color_attributes.new(name='Pigment',type='FLOAT_COLOR',domain='POINT')
    rng=random.Random(seed)
    for i,v in enumerate(mesh.vertices):
        p=v.co; n=.93+.13*rng.random()
        if kind=='leaf':
            light=.85+.22*max(0,min(1,(p.z-.5)/1.6));c=tuple(x*n*light for x in base)
        elif kind=='volcano':
            stripe=.91+.09*math.sin(p.z*34+math.sin(p.x*5));c=tuple(x*n*stripe for x in base)
            if p.z>.83 and math.hypot(p.x,p.y)>.19:c=tuple(.7*x+.3*y for x,y in zip(c,(.7,.68,.58)))
            if p.z>.55 and math.hypot(p.x,p.y)<.18:c=(.09*n,.065*n,.045*n)
        else:c=tuple(x*n*(.92+.08*math.sin(p.z*46+p.x*6)) for x in base)
        layer.data[i].color=(*c,1)
    mesh.materials.clear();mesh.materials.append(mat)

def mesh_object(name,verts,faces):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    for p in me.polygons:p.use_smooth=True
    return ob

def branch(start,end,r0,r1,seed):
    rng=random.Random(seed);a=Vector(start);b=Vector(end);axis=(b-a).normalized();side=axis.cross(Vector((0,1,0))).normalized();other=axis.cross(side)
    verts=[];faces=[];sides=7;steps=5
    for j in range(steps):
        t=j/(steps-1);center=a.lerp(b,t)+side*math.sin(t*math.pi)*r0*.7
        radius=r0*(1-t)+r1*t
        for i in range(sides):
            angle=i/sides*math.tau;v=center+(side*math.cos(angle)+other*math.sin(angle))*radius*(.94+rng.random()*.12);verts.append(tuple(v))
        if j:
            for i in range(sides):
                k=(j-1)*sides+i;n=(i+1)%sides;faces.append((k,(j-1)*sides+n,j*sides+n,j*sides+i))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((steps-1)*sides+i for i in range(sides))]);ob=mesh_object('branch',verts,faces);pigment(ob,(.23,.115,.045),seed,'bark');return ob

def join(parts,name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:p.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();ob=parts[0];ob.name=name
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return ob

def canopy(lobes,name,seed,color):
    parts=[];rng=random.Random(seed)
    for center,scale in lobes:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=center);ob=bpy.context.object
        ob.scale=scale;ob.rotation_euler=(rng.random()*.6,rng.random()*.6,rng.random()*3);parts.append(ob)
    ob=join(parts,name);bpy.context.view_layer.objects.active=ob
    rem=ob.modifiers.new('Union of asymmetric crown lobes','REMESH');rem.mode='VOXEL';rem.voxel_size=.075;rem.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=rem.name)
    smooth=ob.modifiers.new('Organic foliage silhouette','SMOOTH');smooth.factor=.6;smooth.iterations=2;bpy.ops.object.modifier_apply(modifier=smooth.name)
    dec=ob.modifiers.new('Runtime canopy mesh','DECIMATE');dec.ratio=.48;bpy.ops.object.modifier_apply(modifier=dec.name)
    # Petites irrégularités de surface, sans motif de boule visible.
    for v in ob.data.vertices:
        noise=math.sin(v.co.x*23+v.co.z*11)*math.sin(v.co.y*21-v.co.z*15)*.018;v.co+=v.normal*noise
    pigment(ob,color,seed)
    # Feuilles pliées sur l'enveloppe : leur silhouette casse la surface lisse du houppier.
    ob.data.update();verts=[];faces=[]
    candidates=[v for v in ob.data.vertices if v.normal.z>-.2]
    for vertex in rng.sample(candidates,min(85,len(candidates))):
        center=vertex.co+vertex.normal*.008
        normal=vertex.normal.normalized();axis=normal.cross(Vector((0,0,1)))
        if axis.length<.1:axis=Vector((1,0,0))
        axis.normalize();other=normal.cross(axis).normalized()
        for k in range(3):
            a=k*math.tau/3+rng.random();direction=axis*math.cos(a)+other*math.sin(a)
            width=normal.cross(direction)*.021;length=.055+rng.random()*.04
            i=len(verts);verts.extend([tuple(center),tuple(center+direction*length*.5+width+normal*.009),tuple(center+direction*length+normal*.025),tuple(center+direction*length*.5-width+normal*.009)])
            faces.extend([(i,i+1,i+2),(i,i+2,i+3)])
    leaves=mesh_object('Leaf sprigs',verts,faces);pigment(leaves,tuple(x*1.07 for x in color),seed+3)
    return join([ob,leaves],name)

def tree(name,seed,family):
    rng=random.Random(seed);parts=[branch((0,0,0),(.05,-.04,1.3),.085,.028,seed)];lobes=[]
    count=6 if family=='tropical' else 7
    for i in range(count):
        angle=i/count*math.tau+rng.random()*.4
        spread=(.44+rng.random()*.2) if family=='tropical' else .35+rng.random()*.15
        z=(1.22+rng.random()*.25) if family=='tropical' else .9+i*.115
        end=(math.cos(angle)*spread,math.sin(angle)*spread,z)
        parts.append(branch((.025,-.025,.55+i*.085),end,.033,.009,seed+i+11))
        scale=(.42+rng.random()*.12,.35+rng.random()*.12,.25 if family=='tropical' else .34)
        lobes.append(((end[0],end[1],end[2]+.18),scale))
    lobes.append(((.02,-.03,1.7 if family!='tropical' else 1.62),(.4,.36,.32 if family!='tropical' else .2)))
    color=(.14,.31,.055) if family=='tropical' else (.23,.38,.085)
    parts.append(canopy(lobes,'crown',seed,color));return join(parts,name)

def shrub(name,seed):
    return canopy([((-.16,0,.28),(.32,.26,.23)),((.19,.08,.32),(.3,.25,.26)),((0,-.13,.36),(.27,.25,.28))],name,seed,(.23,.34,.075))

def volcano(name,seed):
    rng=random.Random(seed);verts=[];faces=[];sides=64
    profile=[(1.05,0),(.95,.06),(.78,.2),(.61,.43),(.43,.72),(.29,.98),(.245,1.05),(.17,.96),(.12,.7),(0,.6)]
    phase=seed*.7
    for j,(radius,z) in enumerate(profile):
        for i in range(sides):
            a=i/sides*math.tau
            ridge=.1*math.sin(a*9+phase)+.055*math.sin(a*17+z*.7)+.045*math.cos(a*3+phase)
            r=radius*(1+ridge*(.3 if j>6 else 1))
            zz=z+(.035*math.sin(a*5+phase)+.02*math.cos(a*11))*(z**.6 if z else 0)
            verts.append((r*math.cos(a)*(1 if seed%2 else .9)+.08*z,r*math.sin(a),zz))
        if j:
            for i in range(sides):
                k=(j-1)*sides+i;n=(i+1)%sides;faces.append((k,(j-1)*sides+n,j*sides+n,j*sides+i))
    ob=mesh_object(name,verts,faces);pigment(ob,(.38,.28,.19) if seed%2 else (.32,.29,.23),seed,'volcano');return ob

def rock(name,seed):
    rng=random.Random(seed);bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1);ob=bpy.context.object
    for v in ob.data.vertices:
        v.co*=.84+rng.random()*.23;v.co.z=max(-.3,v.co.z*.65);v.co.z+=.32
    ob.name=name;ob.scale=(.45,.34,.55);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    pigment(ob,(.33,.31,.23),seed,'rock');return ob

models=[tree('tropical-a',17,'tropical'),tree('tropical-b',31,'tropical'),tree('layered-a',47,'layered'),tree('layered-b',63,'layered'),shrub('shrub-a',73),shrub('shrub-b',91),volcano('volcano-a',13),volcano('volcano-b',22),rock('rock-a',11),rock('rock-b',29)]
for ob in models:
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.export_scene.gltf(filepath=str(OUT/(ob.name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_materials='EXPORT',export_vertex_color='NAME',export_vertex_color_name='Pigment')
    print('ASSET',ob.name,'faces',len(ob.data.polygons),flush=True)
    light=ob.copy();light.data=ob.data.copy();bpy.context.collection.objects.link(light)
    bpy.ops.object.select_all(action='DESELECT');light.select_set(True);bpy.context.view_layer.objects.active=light
    dec=light.modifiers.new('Light profile','DECIMATE');dec.ratio=.35;bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(ob.name+'-light.glb')),export_format='GLB',use_selection=True,export_yup=True,export_normals=True,export_materials='EXPORT',export_vertex_color='NAME',export_vertex_color_name='Pigment')
    bpy.data.objects.remove(light,do_unlink=True)
# Planche des sources, conservée dans le .blend, sans incidence sur les exports à l'origine.
for i,ob in enumerate(models):ob.location=((i%5-2)*2.9,(i//5)*3.5,0)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=20
scene.world.color=(.23,.23,.23)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.05));floor=bpy.context.object;floor.name='Preview ground';floor.data.materials.append(bpy.data.materials.new('Sand background'));floor.data.materials[0].diffuse_color=(.32,.3,.25,1)
for pos,power,size in [((-5,-4,9),1700,7),((5,3,7),1100,6)]:
    bpy.ops.object.light_add(type='AREA',location=pos);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,1,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(9,-15,14));camera=bpy.context.object;camera.rotation_euler=(Vector((0,1.7,.7))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=16;scene.camera=camera
scene.render.resolution_x=1200;scene.render.resolution_y=750;scene.render.resolution_percentage=100
scene.render.filepath=str(ROOT/'docs/captures/diorama/modeles-blender.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/diorama/modeles.blend'))
bpy.ops.render.render(write_still=True)
